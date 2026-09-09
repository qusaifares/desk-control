import type { ProviderOperationResult } from './monitor-control-provider.js';

/**
 * Hardware USB/KVM switch control.
 *
 * The controller only ever asks a switch to change ownership. Keyboard and
 * mouse data continue to flow through the switch's own silicon - this system
 * never carries HID events.
 */
export interface SetPortRequest {
  switchId: string;
  channelId: string;
  portId: string;
  commandId: string;
  timeoutMs: number;
}

export interface ObservedSwitchState {
  switchId: string;
  /** channelId -> portId currently selected, or null when unreadable. */
  activePorts: Record<string, string | null>;
  reachability: 'reachable' | 'unreachable' | 'unknown';
  error: { code: string; message: string } | null;
}

export interface PeripheralSwitchProvider {
  readonly kind: string;
  discoverSwitches(): Promise<string[]>;
  getObservedState(): Promise<ObservedSwitchState[]>;
  setPort(request: SetPortRequest): Promise<ProviderOperationResult>;
  dispose?(): Promise<void>;
}
