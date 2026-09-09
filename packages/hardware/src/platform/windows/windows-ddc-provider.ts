import type { MonitorCapability } from '@desk-control/domain';
import type { MonitorReport, ObservedMonitorReport } from '@desk-control/protocol';
import type {
  MonitorControlProvider,
  ProviderOperationResult,
  SetInputRequest,
} from '../../monitor-control-provider.js';
import {
  capabilitiesFromVcp,
  describeInputSource,
  inputIdForValue,
  inputSourceValues,
  parseCapabilities,
  VCP_INPUT_SOURCE,
} from './capabilities.js';
import {
  buildWindowsMonitorIdentity,
  normalizeDeviceKey,
  type WindowsEdidRecord,
} from './device-id.js';
import {
  type BridgeRequestError,
  PowerShellDdcBridge,
  type DdcBridge,
} from './powershell-bridge.js';

interface ListResponse {
  monitors: Array<{
    deviceId: string | null;
    adapter: string;
    description: string | null;
    isPrimary: boolean;
    capabilities: string | null;
    capabilitiesError: string | null;
  }>;
  edid: WindowsEdidRecord[];
}

interface ObserveResponse {
  monitors: Array<{
    deviceId: string | null;
    ok: boolean;
    value: number | null;
    error: string | null;
  }>;
}

interface KnownMonitor {
  stableId: string;
  deviceId: string;
  /** inputId -> VCP 0x60 value */
  inputValues: Map<string, number>;
  capabilities: MonitorCapability[];
}

export interface WindowsDdcProviderOptions {
  bridge?: DdcBridge;
  /** How long to keep re-reading the panel to confirm a switch. */
  verifyIntervalMs?: number;
}

/** PowerShell always hands back arrays, but a one-element array can arrive bare. */
function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Real monitor control on Windows, over DDC/CI.
 *
 * Everything platform-specific stops here. The controller sees the same
 * MonitorReport / ObservedMonitorReport shapes the simulator produces, and the
 * stable ids are computed from EDID so a Windows agent and a macOS agent
 * looking at the same panel produce the same id and get merged.
 */
export class WindowsDdcMonitorControlProvider implements MonitorControlProvider {
  readonly kind = 'windows-ddc';

  private readonly bridge: DdcBridge;
  private readonly verifyIntervalMs: number;
  /** stableId -> what we learned at discovery. */
  private known = new Map<string, KnownMonitor>();
  private readonly completedCommands = new Map<string, ProviderOperationResult>();

  constructor(options: WindowsDdcProviderOptions = {}) {
    this.bridge = options.bridge ?? new PowerShellDdcBridge();
    this.verifyIntervalMs = options.verifyIntervalMs ?? 400;
  }

  async discoverMonitors(): Promise<MonitorReport[]> {
    const listing = await this.bridge.request<ListResponse>('list', {}, 20_000);
    const monitors = asArray(listing.monitors).filter((entry) => entry.deviceId);

    const edidByKey = new Map<string, WindowsEdidRecord>();
    for (const record of asArray(listing.edid)) {
      if (record?.instanceName) {
        edidByKey.set(normalizeDeviceKey(record.instanceName), record);
      }
    }

    // Read the live input for every panel in one round trip so wiring can be
    // inferred without a second pass.
    let activeByDeviceId = new Map<string, number>();
    try {
      const observed = await this.bridge.request<ObserveResponse>('observe', {}, 15_000);
      activeByDeviceId = new Map(
        asArray(observed.monitors)
          .filter((entry) => entry.ok && entry.deviceId && entry.value !== null)
          .map((entry) => [entry.deviceId as string, entry.value as number]),
      );
    } catch {
      // Not fatal: we can still report the monitors, just without wiring.
    }

    const known = new Map<string, KnownMonitor>();
    const reports: MonitorReport[] = [];

    for (const entry of monitors) {
      const deviceId = entry.deviceId as string;
      const parsed = entry.capabilities ? parseCapabilities(entry.capabilities) : null;
      const edid = edidByKey.get(normalizeDeviceKey(deviceId)) ?? null;

      const identity = buildWindowsMonitorIdentity({
        edid,
        capabilitiesModel: parsed?.model ?? null,
        fallbackDisambiguator: entry.adapter,
      });

      const values = parsed ? inputSourceValues(parsed.vcp) : [];
      const inputValues = new Map<string, number>();
      const inputs = values.map((value) => {
        const described = describeInputSource(value);
        const id = inputIdForValue(value);
        inputValues.set(id, value);
        return {
          id,
          connector: described.connector,
          ddcInputSourceValue: value,
          detectedName: described.label,
          // DDC cannot tell us what mode a *different* input would negotiate,
          // so this stays null on real hardware rather than being guessed.
          maxMode: null,
        };
      });

      const capabilities = parsed ? capabilitiesFromVcp(parsed.vcp) : [];

      /*
       * Wiring inference.
       *
       * VCP 0x60 reports the monitor's globally selected input, not "the input
       * you are asking down". When a panel answers us at all it is almost
       * always because it is displaying us, so the live input is our cable -
       * but a monitor that keeps DDC alive on an inactive input will mislead
       * us. That is exactly what `wiringOverrides` in the desk config is for,
       * and a user override always wins over this guess.
       */
      const activeValue = activeByDeviceId.get(deviceId);
      const connectedViaInputId =
        activeValue !== undefined && inputValues.has(inputIdForValue(activeValue))
          ? inputIdForValue(activeValue)
          : null;

      known.set(identity.stableId, {
        stableId: identity.stableId,
        deviceId,
        inputValues,
        capabilities,
      });

      reports.push({
        stableId: identity.stableId,
        localHandle: deviceId,
        detectedName: identity.detectedName,
        identity: {
          manufacturerId: identity.manufacturerId,
          model: identity.model,
          serial: identity.serial,
          manufactureYear: identity.manufactureYear,
          weakIdentity: identity.weakIdentity,
        },
        capabilities,
        inputs,
        connectedViaInputId,
        // Conservative: assume DDC only answers on the live input. Being wrong
        // this way costs a rejected command; being wrong the other way would
        // send commands into a void.
        requiresActiveInput: true,
        preferredInputId: null,
      });
    }

    this.known = known;
    return reports;
  }

  async getCapabilities(stableId: string): Promise<MonitorCapability[]> {
    if (this.known.size === 0) await this.discoverMonitors();
    return this.known.get(stableId)?.capabilities ?? [];
  }

  async getObservedState(): Promise<ObservedMonitorReport[]> {
    if (this.known.size === 0) await this.discoverMonitors();

    let response: ObserveResponse;
    try {
      response = await this.bridge.request<ObserveResponse>('observe', {}, 15_000);
    } catch (error) {
      // The bridge itself is down: every monitor is unreadable, and we say so
      // rather than reporting stale values as current.
      return [...this.known.values()].map((monitor) => ({
        stableId: monitor.stableId,
        activeInputId: null,
        powerState: 'unknown' as const,
        reachability: 'unreachable' as const,
        error: { code: 'DEVICE_UNREACHABLE', message: (error as Error).message },
      }));
    }

    const byDeviceId = new Map(
      asArray(response.monitors)
        .filter((entry) => entry.deviceId)
        .map((entry) => [entry.deviceId as string, entry]),
    );

    return [...this.known.values()].map((monitor) => {
      const entry = byDeviceId.get(monitor.deviceId);
      if (!entry || !entry.ok || entry.value === null) {
        return {
          stableId: monitor.stableId,
          activeInputId: null,
          powerState: 'unknown' as const,
          reachability: 'unreachable' as const,
          error: {
            code: 'DEVICE_UNREACHABLE',
            message: entry?.error ?? 'Monitor did not answer DDC',
          },
        };
      }
      return {
        stableId: monitor.stableId,
        activeInputId: inputIdForValue(entry.value),
        powerState: 'on' as const,
        reachability: 'reachable' as const,
        error: null,
      };
    });
  }

  async setInput(request: SetInputRequest): Promise<ProviderOperationResult> {
    const cached = this.completedCommands.get(request.commandId);
    if (cached) return cached;

    if (this.known.size === 0) await this.discoverMonitors();
    const monitor = this.known.get(request.stableId);
    if (!monitor) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_TARGET',
          message: `No such monitor ${request.stableId}`,
          retryable: false,
        },
      };
    }
    if (!monitor.capabilities.includes('input-switch')) {
      return {
        ok: false,
        error: {
          code: 'CAPABILITY_UNSUPPORTED',
          message: 'Monitor does not advertise VCP 0x60 (input source)',
          retryable: false,
        },
      };
    }

    const value = monitor.inputValues.get(request.inputId) ?? request.ddcInputSourceValue;
    if (value === null || value === undefined) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_TARGET',
          message: `Unknown input ${request.inputId}`,
          retryable: false,
        },
      };
    }

    const deadline = Date.now() + request.timeoutMs;

    try {
      await this.bridge.request(
        'setvcp',
        { deviceId: monitor.deviceId, code: VCP_INPUT_SOURCE, value },
        Math.max(2000, Math.min(request.timeoutMs, 10_000)),
      );
    } catch (error) {
      const bridgeError = error as BridgeRequestError;
      return this.finish(request.commandId, {
        ok: false,
        error: {
          code: bridgeError.code ?? 'INTERNAL',
          message: bridgeError.message,
          retryable: true,
        },
      });
    }

    return this.finish(request.commandId, await this.verifySwitch(monitor, value, deadline));
  }

  /**
   * Confirms the panel actually moved, by reading it back.
   *
   * Three outcomes, and the middle one is the interesting one:
   *
   *  - read shows the target      -> success, verified
   *  - reads stop working at all  -> success, unverified. Losing DDC is the
   *                                  normal signature of handing the panel to
   *                                  another computer: from this machine's
   *                                  cable there is nothing left to ask. The
   *                                  controller re-observes via the agent that
   *                                  just gained the input.
   *  - read keeps showing another
   *    input until the deadline   -> failure. The write was accepted and
   *                                  ignored, which some panels do.
   */
  private async verifySwitch(
    monitor: KnownMonitor,
    targetValue: number,
    deadline: number,
  ): Promise<ProviderOperationResult> {
    let sawUnreachable = false;
    let lastValue: number | null = null;

    while (Date.now() < deadline) {
      await sleep(this.verifyIntervalMs);
      try {
        const result = await this.bridge.request<{ value: number }>(
          'getvcp',
          { deviceId: monitor.deviceId, code: VCP_INPUT_SOURCE },
          Math.max(1000, Math.min(deadline - Date.now(), 5000)),
        );
        lastValue = result.value;
        if (result.value === targetValue) return { ok: true };
      } catch {
        sawUnreachable = true;
        break;
      }
    }

    if (sawUnreachable) return { ok: true };

    return {
      ok: false,
      error: {
        code: 'DEVICE_BUSY',
        message:
          lastValue === null
            ? 'Monitor never confirmed the input change'
            : `Monitor accepted the write but stayed on input 0x${lastValue.toString(16)}`,
        retryable: true,
      },
    };
  }

  private finish(commandId: string, result: ProviderOperationResult): ProviderOperationResult {
    if (result.ok) this.completedCommands.set(commandId, result);
    return result;
  }

  async dispose(): Promise<void> {
    await this.bridge.dispose();
  }
}
