import { buildMessage, toProtocolErrorCode, type ProtocolErrorCode } from '@desk-control/protocol';
import {
  commandTargetKey,
  findInputForComputer,
  findPortForComputer,
  hasCapability,
  isInFlight,
  planPreset,
  selectControlPath,
  type CommandPayload,
  type DeskCommand,
  type MonitorCapability,
  type StateOrigin,
} from '@desk-control/domain';
import type { PeripheralSwitchProvider } from '@desk-control/hardware';
import { randomUUID } from 'node:crypto';
import type { ControllerConfig } from './config.js';
import type { DeskStore } from './desk-store.js';
import type { Logger } from './logger.js';

/** How the command service reaches connected agents. */
export interface AgentDispatcher {
  isOnline(agentId: string): boolean;
  send(agentId: string, message: unknown): boolean;
}

export type IssueResult =
  | { status: 'accepted'; commandId: string }
  | { status: 'rejected'; code: ProtocolErrorCode; message: string };

interface IssueMonitorArgs {
  monitorId: string;
  sourceComputerId: string;
  origin: StateOrigin;
  presetId?: string | null;
  commandId?: string;
}

interface IssueBrightnessArgs {
  monitorId: string;
  brightness: number;
  origin: StateOrigin;
  commandId?: string;
}

interface IssuePowerArgs {
  monitorId: string;
  powerState: 'on' | 'standby' | 'off';
  origin: StateOrigin;
  commandId?: string;
}

interface IssuePeripheralArgs {
  peripheralId: string;
  ownerComputerId: string;
  origin: StateOrigin;
  presetId?: string | null;
  commandId?: string;
}

/**
 * Owns the whole command lifecycle: intent -> desired state -> dispatch ->
 * ack -> result, with timeouts and supersession.
 *
 * Every route into the system - a click on a monitor, a preset, and eventually
 * a hotkey or an automation - goes through these two methods. There is no
 * second path that "just applies a preset".
 */
export class CommandService {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: DeskStore,
    private readonly dispatcher: AgentDispatcher,
    private readonly peripheralProvider: PeripheralSwitchProvider,
    private readonly config: ControllerConfig,
    private readonly logger: Logger,
  ) {}

  /* ---------------------------------------------------------------- */

  setMonitorSource(args: IssueMonitorArgs): IssueResult {
    const monitor = this.store.monitors.get(args.monitorId);
    if (!monitor) {
      return {
        status: 'rejected',
        code: 'UNKNOWN_TARGET',
        message: `Unknown monitor ${args.monitorId}`,
      };
    }
    if (!hasCapability(monitor.capabilities, 'input-switch')) {
      return {
        status: 'rejected',
        code: 'CAPABILITY_UNSUPPORTED',
        message: `${monitor.detectedName} cannot switch inputs`,
      };
    }
    const input = findInputForComputer(monitor, args.sourceComputerId);
    if (!input) {
      return {
        status: 'rejected',
        code: 'UNKNOWN_TARGET',
        message: `${this.store.label(args.sourceComputerId)} is not wired to ${this.store.label(monitor.id)}`,
      };
    }

    const payload: CommandPayload = {
      kind: 'set-monitor-input',
      monitorId: monitor.id,
      inputId: input.id,
      sourceComputerId: args.sourceComputerId,
    };

    const command = this.createCommand(payload, args.origin, args.presetId ?? null, args.commandId);

    // Record intent *before* dispatching. If dispatch fails the user's request
    // is still visible in the UI as failed, not silently dropped.
    this.store.desired.monitorSources[monitor.id] = {
      monitorId: monitor.id,
      sourceComputerId: args.sourceComputerId,
      requestedAt: command.issuedAt,
      origin: args.origin,
      commandId: command.id,
      presetId: args.presetId ?? null,
    };

    const path = selectControlPath(monitor, {
      activeInputId: this.store.bestKnownActiveInput(monitor.id),
      isAgentOnline: (agentId) => this.dispatcher.isOnline(agentId),
    });

    if (!path) {
      this.failCommand(command.id, {
        code: 'NO_CONTROL_PATH',
        message:
          'No online agent can reach this monitor over DDC right now. ' +
          'The desk has not been changed.',
        retryable: true,
      });
      return { status: 'accepted', commandId: command.id };
    }

    this.dispatch(command, path.agentId);
    return { status: 'accepted', commandId: command.id };
  }

  /* ---------------------------------------------------------------- */

  /**
   * Brightness and display power.
   *
   * Same lifecycle as an input switch, and deliberately the same code path -
   * capability gate, control-path selection, dispatch, verified result. The
   * only extra check is that the chosen agent claimed it can do this kind of
   * command at all, which is what lets new command kinds ship without a
   * protocol bump.
   */
  setMonitorBrightness(args: IssueBrightnessArgs): IssueResult {
    return this.issueMonitorFeature({
      monitorId: args.monitorId,
      capability: 'brightness',
      capabilityMessage: 'cannot set brightness',
      payload: {
        kind: 'set-monitor-brightness',
        monitorId: args.monitorId,
        brightness: args.brightness,
      },
      origin: args.origin,
      ...(args.commandId ? { commandId: args.commandId } : {}),
    });
  }

  setMonitorPower(args: IssuePowerArgs): IssueResult {
    return this.issueMonitorFeature({
      monitorId: args.monitorId,
      capability: 'power',
      capabilityMessage: 'cannot be powered on or off',
      payload: {
        kind: 'set-monitor-power',
        monitorId: args.monitorId,
        powerState: args.powerState,
      },
      origin: args.origin,
      ...(args.commandId ? { commandId: args.commandId } : {}),
    });
  }

  /** Applies a power state to every monitor that supports it. */
  setAllMonitorsPower(powerState: 'on' | 'standby' | 'off'): {
    commandIds: string[];
    skipped: Array<{ targetId: string; reason: string }>;
  } {
    const commandIds: string[] = [];
    const skipped: Array<{ targetId: string; reason: string }> = [];

    for (const monitor of this.store.monitors.values()) {
      const result = this.setMonitorPower({ monitorId: monitor.id, powerState, origin: 'user' });
      if (result.status === 'accepted') commandIds.push(result.commandId);
      else skipped.push({ targetId: monitor.id, reason: result.code });
    }
    return { commandIds, skipped };
  }

  private issueMonitorFeature(args: {
    monitorId: string;
    capability: MonitorCapability;
    capabilityMessage: string;
    payload: CommandPayload;
    origin: StateOrigin;
    commandId?: string;
  }): IssueResult {
    const monitor = this.store.monitors.get(args.monitorId);
    if (!monitor) {
      return {
        status: 'rejected',
        code: 'UNKNOWN_TARGET',
        message: `Unknown monitor ${args.monitorId}`,
      };
    }
    if (!hasCapability(monitor.capabilities, args.capability)) {
      return {
        status: 'rejected',
        code: 'CAPABILITY_UNSUPPORTED',
        message: `${this.store.label(monitor.id)} ${args.capabilityMessage}`,
      };
    }

    const command = this.createCommand(args.payload, args.origin, null, args.commandId);

    const path = selectControlPath(monitor, {
      activeInputId: this.store.bestKnownActiveInput(monitor.id),
      isAgentOnline: (agentId) =>
        this.dispatcher.isOnline(agentId) &&
        this.store.agentSupportsCommand(agentId, args.payload.kind),
    });

    if (!path) {
      this.failCommand(command.id, {
        code: 'NO_CONTROL_PATH',
        message:
          'No online agent can carry out this command for that monitor right now. ' +
          'The desk has not been changed.',
        retryable: true,
      });
      return { status: 'accepted', commandId: command.id };
    }

    this.dispatch(command, path.agentId);
    return { status: 'accepted', commandId: command.id };
  }

  setPeripheralOwner(args: IssuePeripheralArgs): IssueResult {
    const peripheral = this.store.config.peripherals.find(
      (candidate) => candidate.id === args.peripheralId,
    );
    if (!peripheral) {
      return { status: 'rejected', code: 'UNKNOWN_TARGET', message: 'Unknown peripheral' };
    }
    const peripheralSwitch = this.store.config.peripheralSwitches.find(
      (candidate) => candidate.id === peripheral.switchId,
    );
    if (!peripheralSwitch) {
      return { status: 'rejected', code: 'UNKNOWN_TARGET', message: 'Unknown peripheral switch' };
    }
    if (!hasCapability(peripheralSwitch.capabilities, 'switch-port')) {
      return {
        status: 'rejected',
        code: 'CAPABILITY_UNSUPPORTED',
        message: `${peripheralSwitch.detectedName} cannot switch ports`,
      };
    }
    const port = findPortForComputer(peripheralSwitch, args.ownerComputerId);
    if (!port) {
      return {
        status: 'rejected',
        code: 'UNKNOWN_TARGET',
        message: `${this.store.label(args.ownerComputerId)} is not wired to ${peripheralSwitch.detectedName}`,
      };
    }

    const channelId = peripheral.channelId ?? peripheralSwitch.channels[0] ?? 'default';

    // A single-channel switch moves every peripheral on it at once. Model that
    // honestly instead of pretending the keyboard can move without the mouse.
    const siblings = this.store.config.peripherals.filter(
      (candidate) =>
        candidate.switchId === peripheralSwitch.id &&
        (candidate.channelId ?? peripheralSwitch.channels[0] ?? 'default') === channelId,
    );

    const payload: CommandPayload = {
      kind: 'set-peripheral-owner',
      switchId: peripheralSwitch.id,
      channelId,
      portId: port.id,
      peripheralIds: siblings.map((candidate) => candidate.id),
      ownerComputerId: args.ownerComputerId,
    };

    const existing = this.findInFlightForTarget(commandTargetKey(payload));
    if (
      existing &&
      existing.payload.kind === 'set-peripheral-owner' &&
      existing.payload.portId === port.id
    ) {
      return { status: 'accepted', commandId: existing.id };
    }

    const command = this.createCommand(payload, args.origin, args.presetId ?? null, args.commandId);

    for (const sibling of siblings) {
      this.store.desired.peripheralOwners[sibling.id] = {
        peripheralId: sibling.id,
        ownerComputerId: args.ownerComputerId,
        requestedAt: command.issuedAt,
        origin: args.origin,
        commandId: command.id,
        presetId: args.presetId ?? null,
      };
    }

    void this.executePeripheralCommand(
      command,
      payload,
      siblings.map((s) => s.id),
    );
    return { status: 'accepted', commandId: command.id };
  }

  private async executePeripheralCommand(
    command: DeskCommand,
    payload: Extract<CommandPayload, { kind: 'set-peripheral-owner' }>,
    peripheralIds: string[],
  ): Promise<void> {
    this.store.updateCommand(command.id, { status: 'dispatched', attempts: command.attempts + 1 });
    /*
     * A remote that only cycles cannot be moved without knowing where it is,
     * and the only trustworthy answer is observed: which computer currently
     * enumerates the peripheral. Passing what we last *asked for* would defeat
     * the point.
     */
    const observed = this.store.observedPeripherals()[peripheralIds[0] ?? ''];
    const currentSwitch = this.store.config.peripheralSwitches.find(
      (candidate) => candidate.id === payload.switchId,
    );
    const currentPortId =
      observed?.ownerComputerId && observed.evidence !== 'unknown'
        ? (currentSwitch?.ports.find((port) => port.computerId === observed.ownerComputerId)?.id ??
          null)
        : null;

    const result = await this.peripheralProvider.setPort({
      switchId: payload.switchId,
      channelId: payload.channelId,
      portId: payload.portId,
      currentPortId,
      commandId: command.id,
      timeoutMs: this.config.commandTimeoutMs,
    });

    const observedAt = new Date().toISOString();
    const switchState = (await this.peripheralProvider.getObservedState()).find(
      (candidate) => candidate.switchId === payload.switchId,
    );
    const activePortId = switchState?.activePorts[payload.channelId] ?? null;
    const peripheralSwitch = this.store.config.peripheralSwitches.find(
      (candidate) => candidate.id === payload.switchId,
    );
    const ownerComputerId =
      peripheralSwitch?.ports.find((candidate) => candidate.id === activePortId)?.computerId ??
      null;

    for (const peripheralId of peripheralIds) {
      this.store.setObservedPeripheral({
        peripheralId,
        ownerComputerId,
        // The switch's own account. Overridden by USB evidence when a computer
        // can actually see the device.
        evidence: 'switch-report' as const,
        reachability: switchState?.reachability ?? 'unknown',
        observedAt,
        lastError: switchState?.error ?? null,
      });
    }

    if (result.ok) {
      this.store.updateCommand(command.id, { status: 'succeeded', error: null });
    } else {
      this.failCommand(command.id, {
        code: result.error?.code ?? 'INTERNAL',
        message: result.error?.message ?? 'Peripheral switch failed',
        retryable: result.error?.retryable ?? false,
      });
    }
  }

  /* ---------------------------------------------------------------- */

  applyPreset(presetId: string): {
    status: 'accepted' | 'rejected';
    commandIds: string[];
    skipped: Array<{ targetId: string; reason: string }>;
    message?: string;
  } {
    const preset = this.store.config.presets.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return { status: 'rejected', commandIds: [], skipped: [], message: 'Unknown preset' };
    }

    const plan = planPreset(preset, {
      monitors: [...this.store.monitors.values()],
      peripherals: this.store.config.peripherals,
    });

    const commandIds: string[] = [];
    const skipped: Array<{ targetId: string; reason: string }> = plan.skipped.map((skip) => ({
      targetId: skip.targetId,
      reason: skip.reason,
    }));

    for (const intent of plan.intents) {
      const result =
        intent.target === 'monitor'
          ? this.setMonitorSource({
              monitorId: intent.targetId,
              sourceComputerId: intent.computerId,
              origin: 'preset',
              presetId,
            })
          : this.setPeripheralOwner({
              peripheralId: intent.targetId,
              ownerComputerId: intent.computerId,
              origin: 'preset',
              presetId,
            });

      if (result.status === 'accepted') {
        // Peripherals sharing a switch channel collapse onto one command.
        if (!commandIds.includes(result.commandId)) commandIds.push(result.commandId);
      } else {
        skipped.push({ targetId: intent.targetId, reason: result.code });
      }
    }

    this.store.desired.activePresetId = presetId;
    this.store.touch();
    this.logger.info(
      { presetId, commands: commandIds.length, skipped: skipped.length },
      'Applied preset',
    );
    return { status: 'accepted', commandIds, skipped };
  }

  /* ---------------------------------------------------------------- *
   * Agent responses
   * ---------------------------------------------------------------- */

  onAgentAck(commandId: string): void {
    const command = this.store.commands.get(commandId);
    if (!command || !isInFlight(command.status)) return;
    this.store.updateCommand(commandId, { status: 'acked' });
  }

  onAgentResult(
    commandId: string,
    ok: boolean,
    error: { code: string; message: string; retryable: boolean } | null,
  ): void {
    const command = this.store.commands.get(commandId);
    if (!command || !isInFlight(command.status)) return;
    this.clearTimer(commandId);
    if (ok) {
      this.store.updateCommand(commandId, { status: 'succeeded', error: null });
      if (command.payload.kind === 'set-monitor-input') {
        this.store.noteActiveInput(command.payload.monitorId, command.payload.inputId);
        this.requestFreshObservation(command.payload.monitorId, command.payload.inputId);
      }
    } else {
      this.store.updateCommand(commandId, {
        status: 'failed',
        error: {
          code: toProtocolErrorCode(error?.code ?? 'INTERNAL'),
          message: error?.message ?? 'Agent reported failure',
          retryable: error?.retryable ?? false,
        },
      });
    }
  }

  /**
   * After a successful switch, the agent that just gained the input is the only
   * one that can see the monitor - and it will not poll for another interval.
   * Ask it now so the UI converges in milliseconds instead of seconds.
   */
  private requestFreshObservation(monitorId: string, inputId: string): void {
    const monitor = this.store.monitors.get(monitorId);
    if (!monitor) return;
    for (const path of monitor.controlPaths) {
      if (path.inputId !== inputId) continue;
      if (!this.dispatcher.isOnline(path.agentId)) continue;
      this.dispatcher.send(path.agentId, buildMessage('controller.refresh-inventory', {}));
    }
  }

  /** Called when an agent disconnects: its in-flight commands can never land. */
  failCommandsForAgent(agentId: string): void {
    for (const command of this.store.commands.values()) {
      if (command.agentId === agentId && isInFlight(command.status)) {
        this.failCommand(command.id, {
          code: 'DEVICE_UNREACHABLE',
          message: 'Agent disconnected before reporting a result',
          retryable: true,
        });
      }
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private createCommand(
    payload: CommandPayload,
    origin: StateOrigin,
    presetId: string | null,
    commandId?: string,
  ): DeskCommand {
    this.supersede(commandTargetKey(payload));
    const now = new Date();
    const command: DeskCommand = {
      id: commandId ?? randomUUID(),
      payload,
      status: 'pending',
      origin,
      presetId,
      agentId: null,
      issuedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deadlineAt: new Date(now.getTime() + this.config.commandTimeoutMs).toISOString(),
      attempts: 0,
      error: null,
    };
    this.store.putCommand(command);
    return command;
  }

  private findInFlightForTarget(targetKey: string): DeskCommand | undefined {
    return [...this.store.commands.values()].find(
      (candidate) =>
        isInFlight(candidate.status) && commandTargetKey(candidate.payload) === targetKey,
    );
  }

  /** A newer request for the same target retires the older one. */
  private supersede(targetKey: string): void {
    const stale = this.findInFlightForTarget(targetKey);
    if (!stale) return;
    this.clearTimer(stale.id);
    this.store.updateCommand(stale.id, {
      status: 'superseded',
      error: { code: 'SUPERSEDED', message: 'Replaced by a newer request', retryable: false },
    });
  }

  private dispatch(command: DeskCommand, agentId: string): void {
    const sent = this.dispatcher.send(
      agentId,
      buildMessage('controller.command', {
        commandId: command.id,
        payload: command.payload,
        deadlineAt: command.deadlineAt,
      }),
    );

    if (!sent) {
      this.failCommand(command.id, {
        code: 'DEVICE_UNREACHABLE',
        message: 'Agent went away before the command could be sent',
        retryable: true,
      });
      return;
    }

    this.store.updateCommand(command.id, {
      status: 'dispatched',
      agentId,
      attempts: command.attempts + 1,
    });

    const timer = setTimeout(() => {
      this.timers.delete(command.id);
      const current = this.store.commands.get(command.id);
      if (!current || !isInFlight(current.status)) return;
      this.store.updateCommand(command.id, {
        status: 'timed-out',
        error: {
          code: 'TIMEOUT',
          message: `No result within ${this.config.commandTimeoutMs}ms`,
          retryable: true,
        },
      });
      this.logger.warn({ commandId: command.id, agentId }, 'Command timed out');
    }, this.config.commandTimeoutMs);

    this.timers.set(command.id, timer);
  }

  private failCommand(
    commandId: string,
    error: { code: string; message: string; retryable: boolean },
  ): void {
    this.clearTimer(commandId);
    this.store.updateCommand(commandId, {
      status: 'failed',
      error: { ...error, code: toProtocolErrorCode(error.code) },
    });
    this.logger.warn({ commandId, ...error }, 'Command failed');
  }

  private clearTimer(commandId: string): void {
    const timer = this.timers.get(commandId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(commandId);
    }
  }
}
