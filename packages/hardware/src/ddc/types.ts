/**
 * The contract every platform DDC helper speaks.
 *
 * Windows uses a PowerShell host over dxva2.dll; macOS uses a compiled helper
 * over IOAVService I2C. They share this shape so the provider above them is one
 * implementation rather than one per operating system.
 */
export interface DdcBridge {
  request<TResult>(
    op: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<TResult>;
  dispose(): Promise<void>;
}

/** One monitor as the helper sees it, before any identity work. */
export interface DdcMonitorEntry {
  /** Platform-stable handle. Opaque above the helper. */
  deviceId: string;
  description: string | null;
  /** MCCS capabilities string, when the panel answered. */
  capabilities: string | null;
  capabilitiesError: string | null;
  /** Used for identity only when the panel reports no usable serial. */
  fallbackDisambiguator: string;
}

/**
 * Raw EDID keyed however the platform names displays. The provider joins these
 * to monitors itself, so a helper never has to get the matching right.
 */
export interface DdcEdidEntry {
  key: string;
  edidHex: string;
}

export interface DdcListResponse {
  monitors: DdcMonitorEntry[];
  edid: DdcEdidEntry[];
}

export interface DdcObserveEntry {
  deviceId: string;
  ok: boolean;
  /** Current VCP 0x60 value. */
  value: number | null;
  error: string | null;
}

export interface DdcObserveResponse {
  monitors: DdcObserveEntry[];
}

export interface DdcGetVcpResponse {
  value: number;
  max: number;
  type: number;
}
