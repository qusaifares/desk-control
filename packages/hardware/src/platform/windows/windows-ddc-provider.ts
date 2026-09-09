import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DdcMonitorControlProvider } from '../../ddc/ddc-provider.js';
import { JsonLineProcessBridge, toWindowsPath } from '../../ddc/process-bridge.js';
import type { DdcBridge } from '../../ddc/types.js';
import { DDC_BRIDGE_SCRIPT } from './ddc-bridge-script.js';

/**
 * Writes the embedded PowerShell helper to a temp file, named by content hash
 * so an upgrade never reuses a stale script.
 */
async function scriptPath(): Promise<string> {
  const digest = createHash('sha256').update(DDC_BRIDGE_SCRIPT).digest('hex').slice(0, 12);
  const directory = join(tmpdir(), 'desk-control');
  const path = join(directory, `ddc-bridge-${digest}.ps1`);
  if (!existsSync(path)) {
    await mkdir(directory, { recursive: true });
    // BOM so PowerShell reads it as UTF-8 whatever the console codepage is.
    await writeFile(path, `\ufeff${DDC_BRIDGE_SCRIPT}`, 'utf8');
  }
  return path;
}

export function createWindowsDdcBridge(): DdcBridge {
  return new JsonLineProcessBridge({
    name: 'Windows DDC bridge',
    async resolveCommand() {
      return {
        // powershell.exe is on PATH natively and under WSL interop alike.
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          toWindowsPath(await scriptPath()),
        ],
      };
    },
  });
}

export interface WindowsDdcProviderOptions {
  bridge?: DdcBridge;
  verifyIntervalMs?: number;
}

/**
 * Windows monitor control. All the behaviour lives in DdcMonitorControlProvider;
 * this only supplies the transport.
 */
export class WindowsDdcMonitorControlProvider extends DdcMonitorControlProvider {
  constructor(options: WindowsDdcProviderOptions = {}) {
    super({
      kind: 'windows-ddc',
      bridge: options.bridge ?? createWindowsDdcBridge(),
      ...(options.verifyIntervalMs === undefined
        ? {}
        : { verifyIntervalMs: options.verifyIntervalMs }),
    });
  }
}
