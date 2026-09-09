import type {
  ObservedSwitchState,
  PeripheralSwitchProvider,
  SetPortRequest,
} from '../peripheral-switch-provider.js';
import type { ProviderOperationResult } from '../monitor-control-provider.js';

export interface SimulatedSwitchSpec {
  switchId: string;
  channels: string[];
  ports: string[];
  /** channelId -> initially selected portId */
  initialPorts: Record<string, string>;
  switchDelayMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Simulates a hardware USB switch. Note what it does *not* do: it never sees a
 * key press or a mouse delta. Ownership changes; data keeps flowing through the
 * switch's own hardware.
 */
export class MockPeripheralSwitchProvider implements PeripheralSwitchProvider {
  readonly kind = 'mock';
  private readonly state = new Map<string, Record<string, string | null>>();
  private readonly specs = new Map<string, SimulatedSwitchSpec>();
  private readonly completedCommands = new Map<string, ProviderOperationResult>();
  private readonly busy = new Set<string>();

  constructor(specs: readonly SimulatedSwitchSpec[]) {
    for (const spec of specs) {
      this.specs.set(spec.switchId, spec);
      this.state.set(spec.switchId, { ...spec.initialPorts });
    }
  }

  async discoverSwitches(): Promise<string[]> {
    return [...this.specs.keys()];
  }

  async getObservedState(): Promise<ObservedSwitchState[]> {
    return [...this.specs.keys()].map((switchId) => ({
      switchId,
      activePorts: { ...(this.state.get(switchId) ?? {}) },
      reachability: 'reachable' as const,
      error: null,
    }));
  }

  async setPort(request: SetPortRequest): Promise<ProviderOperationResult> {
    const cached = this.completedCommands.get(request.commandId);
    if (cached) return cached;

    const spec = this.specs.get(request.switchId);
    if (!spec) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_TARGET', message: 'No such switch', retryable: false },
      };
    }
    if (!spec.ports.includes(request.portId)) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_TARGET', message: 'No such port', retryable: false },
      };
    }
    const busyKey = `${request.switchId}:${request.channelId}`;
    if (this.busy.has(busyKey)) {
      return {
        ok: false,
        error: { code: 'DEVICE_BUSY', message: 'Switch is busy', retryable: true },
      };
    }

    this.busy.add(busyKey);
    try {
      await sleep(Math.min(spec.switchDelayMs, request.timeoutMs));
      const channels = this.state.get(request.switchId) ?? {};
      channels[request.channelId] = request.portId;
      this.state.set(request.switchId, channels);
      const result: ProviderOperationResult = { ok: true };
      this.completedCommands.set(request.commandId, result);
      return result;
    } finally {
      this.busy.delete(busyKey);
    }
  }
}
