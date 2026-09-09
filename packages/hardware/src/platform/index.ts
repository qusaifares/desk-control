import type { MonitorControlProvider } from '../monitor-control-provider.js';

/**
 * Real platform providers are deliberately not implemented in this bootstrap.
 *
 * Each will be a self-contained module implementing MonitorControlProvider:
 *   windows  ->  DDC/CI via SetVCPFeature/GetVCPFeature (dxva2.dll) or
 *                MonitorConfiguration API, EDID from SetupAPI/WMI
 *   macos    ->  DDC over I2C via IOKit / CoreDisplay, EDID from IODisplay
 *   linux    ->  ddcutil (i2c-dev), EDID from /sys/class/drm/*\/edid
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
  throw new PlatformProviderNotImplementedError(kind);
}
