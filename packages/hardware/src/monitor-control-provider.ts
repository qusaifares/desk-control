import type { MonitorCapability } from '@desk-control/domain';
import type { MonitorReport, ObservedMonitorReport } from '@desk-control/protocol';

/**
 * The one seam between the controller/agent logic and real display hardware.
 *
 * Everything above this interface is platform agnostic. Implementations may be
 * Windows DDC/CI, macOS DDC, Linux ddcutil, a vendor SDK, or the simulator -
 * and no caller is allowed to care which.
 */
export interface SetInputRequest {
  /** Stable, EDID-derived monitor id. */
  stableId: string;
  /** Provider-private handle from discovery (WMI instance, i2c bus, ...). */
  localHandle: string;
  /** Domain-level input id. */
  inputId: string;
  /** VCP 0x60 value, when the provider needs it. */
  ddcInputSourceValue: number | null;
  /** Idempotency key. Re-issuing the same id must not act twice. */
  commandId: string;
  /** Provider should give up and report a timeout after this. */
  timeoutMs: number;
}

export interface ProviderOperationResult {
  ok: boolean;
  error?: { code: string; message: string; retryable: boolean };
}

export interface MonitorControlProvider {
  /** Short identifier for logs and the agent registration, e.g. "mock". */
  readonly kind: string;

  /** Enumerate monitors this host can currently see and talk to. */
  discoverMonitors(): Promise<MonitorReport[]>;

  /**
   * Capabilities for one monitor. Separate from discovery because probing
   * capabilities can be slow on real hardware and is cached differently.
   */
  getCapabilities(stableId: string): Promise<MonitorCapability[]>;

  /** Current hardware truth. Must never echo back a requested value. */
  getObservedState(): Promise<ObservedMonitorReport[]>;

  setInput(request: SetInputRequest): Promise<ProviderOperationResult>;

  dispose?(): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
