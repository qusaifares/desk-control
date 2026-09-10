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
  /**
   * Where the switch is believed to be now, from observed evidence.
   *
   * A remote that only cycles has no way to jump to a port - you can press the
   * button, but the switch never says where it landed. Knowing the starting
   * point is what turns "press it" into "press it twice". Null means we do not
   * know, and a cycling switch refuses rather than pressing hopefully.
   */
  currentPortId?: string | null;
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
