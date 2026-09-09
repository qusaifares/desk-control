import type { MonitorCapability } from '@desk-control/domain';
import type { MonitorReport, ObservedMonitorReport } from '@desk-control/protocol';
import type {
  MonitorControlProvider,
  ProviderOperationResult,
  SetInputRequest,
} from '../monitor-control-provider.js';
import {
  capabilitiesFromVcp,
  describeInputSource,
  inputIdForValue,
  inputSourceValues,
  parseCapabilities,
  VCP_INPUT_SOURCE,
} from './capabilities.js';
import { parseEdidHex, type EdidIdentity } from './edid.js';
import { buildDdcMonitorIdentity, normalizeDeviceKey } from './identity.js';
import { type BridgeRequestError } from './process-bridge.js';
import type { DdcBridge, DdcGetVcpResponse, DdcListResponse, DdcObserveResponse } from './types.js';

interface KnownMonitor {
  stableId: string;
  deviceId: string;
  /** inputId -> VCP 0x60 value */
  inputValues: Map<string, number>;
  capabilities: MonitorCapability[];
}

export interface DdcProviderOptions {
  /** Reported to the controller, e.g. "windows-ddc". */
  kind: string;
  bridge: DdcBridge;
  /** How long to keep re-reading the panel to confirm a switch. */
  verifyIntervalMs?: number;
}

/** Helpers hand back arrays, but a one-element array can arrive bare. */
function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Real monitor control over DDC/CI, for every platform.
 *
 * There is one of these rather than one per operating system, because only the
 * transport differs: a Windows helper over dxva2.dll and a macOS helper over
 * IOAVService both enumerate displays, hand back an MCCS capabilities string
 * and raw EDID, and move VCP values. Identity, capability gating, wiring
 * inference and switch verification are the same work either way - and doing
 * them once means a bug fixed on one platform is fixed on both.
 */
export class DdcMonitorControlProvider implements MonitorControlProvider {
  readonly kind: string;

  private readonly bridge: DdcBridge;
  private readonly verifyIntervalMs: number;
  private known = new Map<string, KnownMonitor>();
  private readonly completedCommands = new Map<string, ProviderOperationResult>();

  constructor(options: DdcProviderOptions) {
    this.kind = options.kind;
    this.bridge = options.bridge;
    this.verifyIntervalMs = options.verifyIntervalMs ?? 400;
  }

  async discoverMonitors(): Promise<MonitorReport[]> {
    const listing = await this.bridge.request<DdcListResponse>('list', {}, 30_000);
    const monitors = asArray(listing.monitors).filter((entry) => entry.deviceId);

    // EDID is joined here rather than in the helper: the join is fiddly, and
    // this way it is unit-tested instead of buried in a shell script.
    const edidByKey = new Map<string, EdidIdentity>();
    for (const record of asArray(listing.edid)) {
      if (!record?.key || !record.edidHex) continue;
      try {
        edidByKey.set(normalizeDeviceKey(record.key), parseEdidHex(record.edidHex));
      } catch {
        // A corrupt EDID block costs us the serial, not the monitor.
      }
    }

    // Read the live input for every panel in one round trip so wiring can be
    // inferred without a second pass.
    let activeByDeviceId = new Map<string, number>();
    try {
      const observed = await this.bridge.request<DdcObserveResponse>('observe', {}, 20_000);
      activeByDeviceId = new Map(
        asArray(observed.monitors)
          .filter((entry) => entry.ok && entry.deviceId && entry.value !== null)
          .map((entry) => [entry.deviceId, entry.value as number]),
      );
    } catch {
      // Not fatal: report the monitors, just without wiring.
    }

    const known = new Map<string, KnownMonitor>();
    const reports: MonitorReport[] = [];

    for (const entry of monitors) {
      const parsed = entry.capabilities ? parseCapabilities(entry.capabilities) : null;
      const edid = edidByKey.get(normalizeDeviceKey(entry.deviceId)) ?? null;

      const identity = buildDdcMonitorIdentity({
        edid,
        capabilitiesModel: parsed?.model ?? null,
        fallbackDisambiguator: entry.fallbackDisambiguator,
      });

      const inputValues = new Map<string, number>();
      const inputs = (parsed ? inputSourceValues(parsed.vcp) : []).map((value) => {
        const described = describeInputSource(value);
        const id = inputIdForValue(value);
        inputValues.set(id, value);
        return {
          id,
          connector: described.connector,
          ddcInputSourceValue: value,
          detectedName: described.label,
          // DDC cannot report what mode a *different* input would negotiate, so
          // this stays null on real hardware rather than being guessed.
          maxMode: null,
        };
      });

      const capabilities = parsed ? capabilitiesFromVcp(parsed.vcp) : [];

      /*
       * Wiring inference.
       *
       * VCP 0x60 reports the monitor's globally selected input, not "the input
       * you are asking down". When a panel answers us at all it is almost
       * always because it is displaying us, so the live input is taken to be
       * our cable - but a monitor that keeps DDC alive on an inactive input
       * will mislead this guess. That is what `wiringOverrides` in the desk
       * config is for, and a user override always wins.
       */
      const activeValue = activeByDeviceId.get(entry.deviceId);
      const connectedViaInputId =
        activeValue !== undefined && inputValues.has(inputIdForValue(activeValue))
          ? inputIdForValue(activeValue)
          : null;

      known.set(identity.stableId, {
        stableId: identity.stableId,
        deviceId: entry.deviceId,
        inputValues,
        capabilities,
      });

      reports.push({
        stableId: identity.stableId,
        localHandle: entry.deviceId,
        detectedName: identity.detectedName,
        identity: {
          manufacturerId: identity.manufacturerId,
          model: identity.model,
          serial: identity.serial,
          manufactureYear: identity.manufactureYear,
          weakIdentity: identity.weakIdentity,
          physicalSizeInches: identity.physicalSizeInches,
        },
        capabilities,
        inputs,
        connectedViaInputId,
        // Conservative: assume DDC only answers on the live input. Being wrong
        // this way costs a refused command; being wrong the other way would
        // send commands into a void and report success that never happened.
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

    let response: DdcObserveResponse;
    try {
      response = await this.bridge.request<DdcObserveResponse>('observe', {}, 20_000);
    } catch (error) {
      // The helper itself is down: every monitor is unreadable, and we say so
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
        .map((entry) => [entry.deviceId, entry]),
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
   *
   * It polls rather than reading once because a panel can report its previous
   * input for a moment while it re-syncs.
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
        const result = await this.bridge.request<DdcGetVcpResponse>(
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
