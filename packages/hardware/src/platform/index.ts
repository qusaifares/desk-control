import type { MonitorControlProvider } from '../monitor-control-provider.js';
import { WindowsDdcMonitorControlProvider } from './windows/windows-ddc-provider.js';

/**
 * Platform providers.
 *
 *   windows  ->  implemented: DDC/CI via dxva2.dll, EDID from WMI
 *   macos    ->  not implemented: DDC over I2C via IOKit / CoreDisplay,
 *                EDID from IODisplay
 *   linux    ->  not implemented: ddcutil (i2c-dev),
 *                EDID from /sys/class/drm/*\/edid
 *
 * The important property is that adding one changes nothing above this file.
 */
export type PlatformProviderKind = 'windows-ddc' | 'macos-ddc' | 'linux-ddcutil' | 'mock';

export class PlatformProviderNotImplementedError extends Error {
  constructor(kind: PlatformProviderKind) {
    super(
      `Monitor control provider "${kind}" is not implemented yet. ` +
        `Run the agent with --provider mock, or implement it in @desk-control/hardware/platform.`,
    );
    this.name = 'PlatformProviderNotImplementedError';
  }
}

export function createPlatformProvider(kind: PlatformProviderKind): MonitorControlProvider {
  if (kind === 'windows-ddc') return new WindowsDdcMonitorControlProvider();
  throw new PlatformProviderNotImplementedError(kind);
}
