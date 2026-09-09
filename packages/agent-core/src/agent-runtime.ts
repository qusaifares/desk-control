import type { ControllerDiscovery } from '@desk-control/discovery';
import type { ComputerCapability, Platform } from '@desk-control/domain';
import type { MonitorControlProvider } from '@desk-control/hardware';
import {
  buildMessage,
  parseControllerMessage,
  toProtocolErrorCode,
  type ControllerToAgentMessage,
  type MonitorReport,
  type ObservedMonitorReport,
} from '@desk-control/protocol';
import type { AgentTransport } from './transport.js';

export interface AgentLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface AgentRuntimeOptions {
  agentId: string;
  computerId: string;
  detectedName: string;
  computerDetectedName: string;
  platform: Platform;
  agentVersion: string;
  capabilities: ComputerCapability[];
  metadata?: Record<string, string>;
  provider: MonitorControlProvider;
  discovery: ControllerDiscovery;
  createTransport: () => AgentTransport;
  authToken?: string | null;
  observeIntervalMs?: number;
  heartbeatIntervalMs?: number;
  reconnectDelayMs?: number;
  logger?: AgentLogger;
}

const noopLogger: AgentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * The agent side of the protocol, independent of platform and of transport.
 *
 * Responsibilities, in order of importance:
 *   1. Never lie. Observations are read back from the provider, never inferred
 *      from a command we just sent.
 *   2. Stay passive on failure. Losing the controller changes nothing about the
 *      hardware; we simply retry the connection.
 *   3. Be idempotent. Command ids are remembered so a redelivered command is
 *      answered from cache instead of re-driving the monitor.
 */
export class AgentRuntime {
  private transport: AgentTransport | null = null;
  /** In-flight connection attempt, so two triggers cannot open two sockets. */
  private connectPromise: Promise<void> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private connected = false;
  private startedAt = Date.now();
  private monitors: MonitorReport[] = [];
  private readonly handledCommands = new Map<string, boolean>();
  private readonly logger: AgentLogger;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.logger = options.logger ?? noopLogger;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.startedAt = Date.now();
    await this.options.discovery.start();
    // onFound fires immediately for endpoints that are already known, so this
    // and the explicit call below must collapse into a single attempt.
    this.options.discovery.onFound(() => void this.connectLoop());
    await this.connectLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.transport?.close();
    this.transport = null;
    this.connected = false;
    await this.options.discovery.stop();
    await this.options.provider.dispose?.();
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.options.reconnectDelayMs ?? 2000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectLoop();
    }, delay);
  }

  private connectLoop(): Promise<void> {
    if (this.stopped || this.connected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOnce().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connectOnce(): Promise<void> {
    const endpoint = this.options.discovery.list()[0];
    if (!endpoint) {
      this.logger.warn('No controller endpoint discovered yet; will retry', {
        agentId: this.options.agentId,
      });
      this.scheduleReconnect();
      return;
    }

    const transport = this.options.createTransport();
    try {
      await transport.connect(endpoint.agentUrl);
    } catch (error) {
      this.logger.warn('Controller connection failed; will retry', {
        agentId: this.options.agentId,
        url: endpoint.agentUrl,
        error: (error as Error).message,
      });
      this.scheduleReconnect();
      return;
    }

    this.transport = transport;
    this.connected = true;
    transport.onMessage((message) => void this.handleMessage(message));
    transport.onClose((reason) => {
      // Ignore close events from a socket we have already replaced.
      if (this.transport !== transport) return;
      this.connected = false;
      this.clearTimers();
      this.transport = null;
      // Fail passive: the desk keeps whatever state it has. We only reconnect.
      this.logger.warn('Disconnected from controller', {
        agentId: this.options.agentId,
        reason,
      });
      this.scheduleReconnect();
    });

    await this.sendHello();
  }

  private async sendHello(): Promise<void> {
    this.monitors = await this.options.provider.discoverMonitors();
    this.send(
      buildMessage('agent.hello', {
        agent: {
          id: this.options.agentId,
          detectedName: this.options.detectedName,
          agentVersion: this.options.agentVersion,
          providerKind: this.options.provider.kind,
        },
        computer: {
          id: this.options.computerId,
          detectedName: this.options.computerDetectedName,
          platform: this.options.platform,
          capabilities: this.options.capabilities,
          metadata: this.options.metadata ?? {},
        },
        monitors: this.monitors,
        authToken: this.options.authToken ?? null,
      }),
    );
  }

  private send(message: unknown): void {
    this.transport?.send(message);
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const parsed = parseControllerMessage(raw);
    if (!parsed.success) {
      this.send(
        buildMessage('agent.error', {
          code: 'INVALID_MESSAGE' as const,
          message: parsed.error.message,
          retryable: false,
          relatedMessageId: null,
        }),
      );
      return;
    }

    const message = parsed.data;
    switch (message.type) {
      case 'controller.welcome': {
        this.logger.info('Registered with controller', {
          agentId: this.options.agentId,
          controller: message.payload.controller.name,
        });
        this.startPeriodicWork(
          message.payload.heartbeatIntervalMs,
          message.payload.observeIntervalMs,
        );
        await this.pushObservedState();
        break;
      }
      case 'controller.reject': {
        this.logger.error('Controller rejected this agent', {
          agentId: this.options.agentId,
          code: message.payload.code,
          detail: message.payload.message,
        });
        this.transport?.close();
        break;
      }
      case 'controller.ping': {
        this.sendHeartbeat();
        break;
      }
      case 'controller.refresh-inventory': {
        this.monitors = await this.options.provider.discoverMonitors();
        this.send(buildMessage('agent.inventory', { monitors: this.monitors }));
        await this.pushObservedState();
        break;
      }
      case 'controller.command': {
        await this.handleCommand(message.payload);
        break;
      }
    }
  }

  private startPeriodicWork(heartbeatIntervalMs: number, observeIntervalMs: number): void {
    this.clearTimers();
    this.timers.push(
      setInterval(
        () => this.sendHeartbeat(),
        this.options.heartbeatIntervalMs ?? heartbeatIntervalMs,
      ),
    );
    this.timers.push(
      setInterval(
        () => void this.pushObservedState(),
        this.options.observeIntervalMs ?? observeIntervalMs,
      ),
    );
  }

  private sendHeartbeat(): void {
    this.send(
      buildMessage('agent.heartbeat', {
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      }),
    );
  }

  private async pushObservedState(): Promise<ObservedMonitorReport[]> {
    let observed: ObservedMonitorReport[] = [];
    try {
      observed = await this.options.provider.getObservedState();
    } catch (error) {
      this.logger.error('Failed to read observed state', {
        agentId: this.options.agentId,
        error: (error as Error).message,
      });
      return [];
    }
    this.send(buildMessage('agent.observed-state', { monitors: observed }));
    return observed;
  }

  private async handleCommand(
    payload: Extract<ControllerToAgentMessage, { type: 'controller.command' }>['payload'],
  ): Promise<void> {
    this.send(buildMessage('agent.command-ack', { commandId: payload.commandId }));

    if (this.handledCommands.has(payload.commandId)) {
      // Idempotency: answer from cache, do not touch the hardware again.
      this.send(
        buildMessage('agent.command-result', {
          commandId: payload.commandId,
          ok: this.handledCommands.get(payload.commandId) ?? false,
          error: null,
          observed: await this.pushObservedState(),
        }),
      );
      return;
    }

    if (payload.payload.kind !== 'set-monitor-input') {
      this.send(
        buildMessage('agent.command-result', {
          commandId: payload.commandId,
          ok: false,
          error: {
            code: 'UNKNOWN_COMMAND_KIND' as const,
            message: `Agent cannot execute ${payload.payload.kind}`,
            retryable: false,
            relatedMessageId: null,
          },
          observed: [],
        }),
      );
      return;
    }

    const { monitorId, inputId } = payload.payload;
    const monitor = this.monitors.find((candidate) => candidate.stableId === monitorId);
    const input = monitor?.inputs.find((candidate) => candidate.id === inputId);

    if (!monitor || !input) {
      this.send(
        buildMessage('agent.command-result', {
          commandId: payload.commandId,
          ok: false,
          error: {
            code: 'UNKNOWN_TARGET' as const,
            message: `Agent does not see monitor ${monitorId} input ${inputId}`,
            retryable: false,
            relatedMessageId: null,
          },
          observed: await this.pushObservedState(),
        }),
      );
      return;
    }

    const timeoutMs = Math.max(1000, Date.parse(payload.deadlineAt) - Date.now());
    const result = await this.options.provider.setInput({
      stableId: monitor.stableId,
      localHandle: monitor.localHandle,
      inputId: input.id,
      ddcInputSourceValue: input.ddcInputSourceValue,
      commandId: payload.commandId,
      timeoutMs,
    });

    if (result.ok) this.handledCommands.set(payload.commandId, true);

    // Read hardware back before reporting. This is the line that keeps the
    // system honest about desired vs observed.
    const observed = await this.pushObservedState();

    this.send(
      buildMessage('agent.command-result', {
        commandId: payload.commandId,
        ok: result.ok,
        error: result.error
          ? {
              code: toProtocolErrorCode(result.error.code),
              message: result.error.message,
              retryable: result.error.retryable,
              relatedMessageId: null,
            }
          : null,
        observed,
      }),
    );
  }
}
