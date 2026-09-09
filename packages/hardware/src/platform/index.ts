import type { MonitorControlProvider } from '../monitor-control-provider.js';
import { MacOsDdcMonitorControlProvider } from './macos/macos-ddc-provider.js';
import { WindowsDdcMonitorControlProvider } from './windows/windows-ddc-provider.js';

/**
 * Platform providers.
 *
 *   windows  ->  implemented: DDC/CI via dxva2.dll, EDID from the device registry
 *   macos    ->  implemented: raw I2C via IOAVService, EDID from the AV service
 *   linux    ->  not implemented: ddcutil (i2c-dev),
 *                EDID from /sys/class/drm/*\/edid
 *
 * Both implemented providers are the same class over a different transport.
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
  if (kind === 'macos-ddc') return new MacOsDdcMonitorControlProvider();
  throw new PlatformProviderNotImplementedError(kind);
}
