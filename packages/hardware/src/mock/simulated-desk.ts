import type { Connector, DisplayMode, MonitorCapability } from '@desk-control/domain';

/**
 * An in-memory model of real desk hardware, shared by every mock agent in a dev
 * session. It exists so the simulator behaves like *one* physical desk: if the
 * gaming PC's agent switches a monitor to the MacBook input, the MacBook's
 * agent must see that too, and the PC's agent must then lose DDC access to the
 * monitor exactly the way real DDC/CI does.
 */
export interface SimulatedMonitorInput {
  id: string;
  connector: Connector;
  ddcInputSourceValue: number | null;
  detectedName: string;
  /** Which simulated computer's cable is in this port. */
  connectedComputerId: string | null;
  maxMode: DisplayMode | null;
}

export interface SimulatedMonitorSpec {
  stableId: string;
  detectedName: string;
  manufacturerId: string;
  model: string;
  serial: string | null;
  manufactureYear: number | null;
  /** Diagonal in inches, as a real panel reports through EDID. */
  physicalSizeInches?: number | null;
  capabilities: MonitorCapability[];
  inputs: SimulatedMonitorInput[];
  activeInputId: string;
  preferredInputId: string | null;
  /** Mirrors the real constraint that DDC only answers on the live input. */
  requiresActiveInput: boolean;
  /** How long the panel takes to re-sync after an input change. */
  switchDelayMs: number;
  /** Percentage, when the panel supports brightness. */
  brightness?: number;
}

export type SimulatedFault =
  | { mode: 'fail'; code: string; message: string }
  | { mode: 'unreachable'; code: string; message: string }
  | { mode: 'timeout' };

export interface SimulatedMonitor extends SimulatedMonitorSpec {
  /** Set while a switch is in progress; the panel is between inputs. */
  switchingToInputId: string | null;
  fault: SimulatedFault | null;
  currentBrightness: number;
  currentPowerState: 'on' | 'standby' | 'off';
}

export interface SwitchOutcome {
  ok: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SimulatedDesk {
  private readonly monitors = new Map<string, SimulatedMonitor>();
  /** commandId -> outcome, so a replayed command is answered, not re-run. */
  private readonly completedCommands = new Map<string, SwitchOutcome>();
  private readonly listeners = new Set<() => void>();

  constructor(specs: readonly SimulatedMonitorSpec[]) {
    for (const spec of specs) {
      this.monitors.set(spec.stableId, {
        ...spec,
        inputs: spec.inputs.map((input) => ({ ...input })),
        switchingToInputId: null,
        fault: null,
        currentBrightness: spec.brightness ?? 60,
        currentPowerState: 'on',
      });
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  list(): SimulatedMonitor[] {
    return [...this.monitors.values()];
  }

  get(stableId: string): SimulatedMonitor | undefined {
    return this.monitors.get(stableId);
  }

  /** Monitors that have a cable from this computer plugged into them. */
  wiredTo(computerId: string): SimulatedMonitor[] {
    return this.list().filter((monitor) =>
      monitor.inputs.some((input) => input.connectedComputerId === computerId),
    );
  }

  inputForComputer(stableId: string, computerId: string): SimulatedMonitorInput | undefined {
    return this.get(stableId)?.inputs.find((input) => input.connectedComputerId === computerId);
  }

  /**
   * True when a computer can currently talk DDC to a monitor. For a monitor
   * that requires the active input, only the machine whose cable is live can.
   */
  canControl(stableId: string, computerId: string): boolean {
    const monitor = this.get(stableId);
    if (!monitor) return false;
    if (monitor.fault?.mode === 'unreachable') return false;
    const input = this.inputForComputer(stableId, computerId);
    if (!input) return false;
    if (!monitor.requiresActiveInput) return true;
    return monitor.activeInputId === input.id && monitor.switchingToInputId === null;
  }

  injectFault(stableId: string, fault: SimulatedFault | null): void {
    const monitor = this.monitors.get(stableId);
    if (!monitor) return;
    monitor.fault = fault;
    this.emit();
  }

  /**
   * Performs an input change with a simulated panel delay. Concurrent commands
   * against the same monitor are rejected as busy rather than queued: real
   * panels behave badly when hammered, and the controller already supersedes.
   */
  async switchInput(args: {
    stableId: string;
    inputId: string;
    commandId: string;
    timeoutMs: number;
  }): Promise<SwitchOutcome> {
    const cached = this.completedCommands.get(args.commandId);
    if (cached) return cached;

    const monitor = this.monitors.get(args.stableId);
    if (!monitor) {
      return this.finish(args.commandId, {
        ok: false,
        error: {
          code: 'UNKNOWN_TARGET',
          message: `No such monitor ${args.stableId}`,
          retryable: false,
        },
      });
    }
    if (!monitor.capabilities.includes('input-switch')) {
      return this.finish(args.commandId, {
        ok: false,
        error: {
          code: 'CAPABILITY_UNSUPPORTED',
          message: `${monitor.detectedName} cannot switch inputs`,
          retryable: false,
        },
      });
    }
    if (!monitor.inputs.some((input) => input.id === args.inputId)) {
      return this.finish(args.commandId, {
        ok: false,
        error: {
          code: 'UNKNOWN_TARGET',
          message: `No such input ${args.inputId}`,
          retryable: false,
        },
      });
    }
    if (monitor.switchingToInputId !== null) {
      return {
        ok: false,
        error: { code: 'DEVICE_BUSY', message: 'A switch is already in progress', retryable: true },
      };
    }
    if (monitor.fault?.mode === 'unreachable') {
      return this.finish(args.commandId, {
        ok: false,
        error: { code: monitor.fault.code, message: monitor.fault.message, retryable: true },
      });
    }
    if (monitor.fault?.mode === 'fail') {
      return this.finish(args.commandId, {
        ok: false,
        error: { code: monitor.fault.code, message: monitor.fault.message, retryable: false },
      });
    }

    if (monitor.activeInputId === args.inputId) {
      return this.finish(args.commandId, { ok: true });
    }

    monitor.switchingToInputId = args.inputId;
    this.emit();

    if (monitor.fault?.mode === 'timeout') {
      await sleep(args.timeoutMs);
      monitor.switchingToInputId = null;
      this.emit();
      return this.finish(args.commandId, {
        ok: false,
        error: { code: 'TIMEOUT', message: 'Monitor did not respond', retryable: true },
      });
    }

    await sleep(Math.min(monitor.switchDelayMs, args.timeoutMs));
    monitor.activeInputId = args.inputId;
    monitor.switchingToInputId = null;
    this.emit();
    return this.finish(args.commandId, { ok: true });
  }

  /** Applies a brightness change, gated on the capability the panel reports. */
  setBrightness(stableId: string, brightness: number): SwitchOutcome {
    const monitor = this.monitors.get(stableId);
    if (!monitor) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_TARGET', message: 'No such monitor', retryable: false },
      };
    }
    if (!monitor.capabilities.includes('brightness')) {
      return {
        ok: false,
        error: {
          code: 'CAPABILITY_UNSUPPORTED',
          message: `${monitor.detectedName} does not support brightness`,
          retryable: false,
        },
      };
    }
    if (monitor.fault?.mode === 'unreachable') {
      return {
        ok: false,
        error: { code: monitor.fault.code, message: monitor.fault.message, retryable: true },
      };
    }
    monitor.currentBrightness = Math.max(0, Math.min(100, Math.round(brightness)));
    this.emit();
    return { ok: true };
  }

  setPowerState(stableId: string, powerState: 'on' | 'standby' | 'off'): SwitchOutcome {
    const monitor = this.monitors.get(stableId);
    if (!monitor) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_TARGET', message: 'No such monitor', retryable: false },
      };
    }
    if (!monitor.capabilities.includes('power')) {
      return {
        ok: false,
        error: {
          code: 'CAPABILITY_UNSUPPORTED',
          message: `${monitor.detectedName} does not support power control`,
          retryable: false,
        },
      };
    }
    monitor.currentPowerState = powerState;
    this.emit();
    return { ok: true };
  }

  private finish(commandId: string, outcome: SwitchOutcome): SwitchOutcome {
    this.completedCommands.set(commandId, outcome);
    return outcome;
  }
}
