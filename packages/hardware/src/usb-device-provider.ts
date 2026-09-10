/**
 * Lists the USB devices a machine currently has attached.
 *
 * This exists so peripheral ownership can be *observed* rather than assumed. A
 * cheap KM switch has no way to report which port it selected, so the only
 * honest answer to "where is the keyboard?" is to ask the computers: whichever
 * one enumerates the device is holding it.
 *
 * Deliberately narrow. It reports identities, never input: this never sees a
 * keystroke or a mouse movement, only that a device with a given USB id is
 * present.
 */
export interface UsbDeviceProvider {
  readonly kind: string;
  /** Attached devices as lowercase `vendor:product`, e.g. "046d:c52b". */
  listDevices(): Promise<string[]>;
  dispose?(): Promise<void>;
}

/** Normalises whatever a platform reports into `vendor:product`, lowercase. */
export function normalizeUsbId(value: string): string | null {
  const match = /([0-9a-f]{4})[:_&-]?(?:pid_)?([0-9a-f]{4})/i.exec(value.replace(/vid_/i, ''));
  if (!match) return null;
  return `${match[1]!.toLowerCase()}:${match[2]!.toLowerCase()}`;
}

export class StaticUsbDeviceProvider implements UsbDeviceProvider {
  readonly kind = 'static';
  constructor(private devices: string[] = []) {}
  async listDevices(): Promise<string[]> {
    return [...this.devices];
  }
  /** Test and simulator hook: move a device to or from this machine. */
  setDevices(devices: string[]): void {
    this.devices = [...devices];
  }
}
