import { displayName, type ControllerInfo } from '@desk-control/domain';
import {
  buildMessage,
  isSupportedProtocolVersion,
  parseAgentMessage,
  PROTOCOL_VERSION,
  type ProtocolErrorCode,
} from '@desk-control/protocol';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { CommandService, AgentDispatcher } from './command-service.js';
import type { ControllerConfig } from './config.js';
import type { DeskStore } from './desk-store.js';
import type { Logger } from './logger.js';

interface AgentConnection {
  socket: WebSocket;
  agentId: string | null;
  sessionId: string;
  lastSeenAt: number;
}

/**
 * The controller side of the agent protocol.
 *
 * Security posture for this bootstrap: every frame is schema-validated, the
 * protocol version is checked before anything is trusted, and an optional
 * shared pairing token gates registration. That is deliberately modest - see
 * docs/protocol.md for the pairing design this is shaped to accept.
 */
export class AgentGateway implements AgentDispatcher {
  private readonly connections = new Set<AgentConnection>();
  private readonly byAgentId = new Map<string, AgentConnection>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private commandService: CommandService | null = null;

  constructor(
    private readonly store: DeskStore,
    private readonly config: ControllerConfig,
    private readonly controllerInfo: ControllerInfo,
    private readonly logger: Logger,
  ) {}

  attachCommandService(commandService: CommandService): void {
    this.commandService = commandService;
  }

  start(): void {
    this.sweepTimer = setInterval(
      () => this.sweep(),
      Math.max(1000, this.config.agentTimeoutMs / 3),
    );
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const connection of this.connections) connection.socket.close();
    this.connections.clear();
    this.byAgentId.clear();
  }

  /* -------------------------------------------------------------- */

  isOnline(agentId: string): boolean {
    return this.byAgentId.has(agentId) && this.store.isAgentOnline(agentId);
  }

  send(agentId: string, message: unknown): boolean {
    const connection = this.byAgentId.get(agentId);
    if (!connection || connection.socket.readyState !== connection.socket.OPEN) return false;
    connection.socket.send(JSON.stringify(message));
    return true;
  }

  /* -------------------------------------------------------------- */

  handleConnection(socket: WebSocket): void {
    const connection: AgentConnection = {
      socket,
      agentId: null,
      sessionId: randomUUID(),
      lastSeenAt: Date.now(),
    };
    this.connections.add(connection);

    socket.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        this.reject(connection, 'INVALID_MESSAGE', 'Frame was not valid JSON');
        return;
      }
      this.handleMessage(connection, raw);
    });

    socket.on('close', () => this.handleClose(connection, 'socket closed'));
    socket.on('error', (error) => this.handleClose(connection, error.message));
  }

  private handleMessage(connection: AgentConnection, raw: unknown): void {
    const versionCandidate = (raw as { v?: unknown })?.v;
    if (typeof versionCandidate === 'number' && !isSupportedProtocolVersion(versionCandidate)) {
      this.reject(
        connection,
        'UNSUPPORTED_PROTOCOL_VERSION',
        `Controller speaks protocol v${PROTOCOL_VERSION}, agent sent v${versionCandidate}`,
      );
      return;
    }

    const parsed = parseAgentMessage(raw);
    if (!parsed.success) {
      this.reject(connection, 'INVALID_MESSAGE', parsed.error.message);
      return;
    }

    const message = parsed.data;
    connection.lastSeenAt = Date.now();
    this.logger.debug({ agentId: connection.agentId, type: message.type }, 'Agent frame');

    if (message.type === 'agent.hello') {
      this.handleHello(connection, message.payload, message.v);
      return;
    }

    if (!connection.agentId) {
      this.reject(connection, 'UNKNOWN_AGENT', 'Send agent.hello before anything else');
      return;
    }
    this.store.markAgentSeen(connection.agentId);

    switch (message.type) {
      case 'agent.heartbeat':
        this.store.touch();
        break;
      case 'agent.inventory': {
        const agent = this.store.agents.get(connection.agentId);
        if (agent) {
          this.store.applyMonitorReports(agent.id, agent.computerId, message.payload.monitors);
        }
        break;
      }
      case 'agent.observed-state':
        this.store.applyObservedReports(connection.agentId, message.payload.monitors);
        break;
      case 'agent.command-ack':
        this.commandService?.onAgentAck(message.payload.commandId);
        break;
      case 'agent.command-result':
        this.store.applyObservedReports(connection.agentId, message.payload.observed);
        this.commandService?.onAgentResult(
          message.payload.commandId,
          message.payload.ok,
          message.payload.error,
        );
        break;
      case 'agent.error':
        this.logger.warn(
          { agentId: connection.agentId, code: message.payload.code },
          message.payload.message,
        );
        break;
    }
  }

  private handleHello(
    connection: AgentConnection,
    payload: Parameters<DeskStore['registerAgent']>[0],
    protocolVersion: number,
  ): void {
    if (this.config.pairingToken && payload.authToken !== this.config.pairingToken) {
      this.reject(connection, 'UNAUTHORIZED', 'Pairing token missing or incorrect');
      return;
    }

    // A reconnecting agent replaces its old socket rather than doubling up.
    const previous = this.byAgentId.get(payload.agent.id);
    if (previous && previous !== connection) {
      previous.socket.close();
      this.connections.delete(previous);
    }

    const agent = this.store.registerAgent(payload, protocolVersion);
    connection.agentId = agent.id;
    this.byAgentId.set(agent.id, connection);

    connection.socket.send(
      JSON.stringify(
        buildMessage('controller.welcome', {
          controller: this.controllerInfo,
          sessionId: connection.sessionId,
          heartbeatIntervalMs: this.config.heartbeatIntervalMs,
          commandTimeoutMs: this.config.commandTimeoutMs,
          observeIntervalMs: this.config.observeIntervalMs,
        }),
      ),
    );

    this.logger.info(
      {
        agentId: agent.id,
        computer: displayName(this.store.computers.get(agent.computerId) ?? agent),
        provider: agent.providerKind,
        monitors: payload.monitors.length,
      },
      'Agent registered',
    );
  }

  private reject(connection: AgentConnection, code: ProtocolErrorCode, message: string): void {
    this.logger.warn({ code }, `Rejecting agent connection: ${message}`);
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.send(
        JSON.stringify(
          buildMessage('controller.reject', {
            code,
            message,
            retryable: false,
            relatedMessageId: null,
          }),
        ),
      );
    }
    connection.socket.close();
  }

  /**
   * Fail passive on disconnect: the agent record is marked offline and its
   * in-flight commands are failed, but monitors, wiring and the last known
   * observations are all left untouched. The desk itself has not changed.
   */
  private handleClose(connection: AgentConnection, reason: string): void {
    if (!this.connections.delete(connection)) return;
    if (!connection.agentId) return;
    if (this.byAgentId.get(connection.agentId) === connection) {
      this.byAgentId.delete(connection.agentId);
    }
    this.store.setAgentOffline(connection.agentId, 'offline', reason);
    this.commandService?.failCommandsForAgent(connection.agentId);
    this.logger.warn({ agentId: connection.agentId, reason }, 'Agent disconnected');
  }

  /** Catches half-open sockets that never fire a close event. */
  private sweep(): void {
    const now = Date.now();
    for (const connection of [...this.connections]) {
      if (!connection.agentId) continue;
      if (now - connection.lastSeenAt > this.config.agentTimeoutMs) {
        this.logger.warn({ agentId: connection.agentId }, 'Agent heartbeat timed out');
        connection.socket.terminate();
        this.handleClose(connection, 'heartbeat timeout');
      }
    }
  }
}
