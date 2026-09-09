import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DdcMonitorControlProvider } from '../../ddc/ddc-provider.js';
import { JsonLineProcessBridge } from '../../ddc/process-bridge.js';
import type { DdcBridge } from '../../ddc/types.js';
import { MACOS_DDC_HELPER_SOURCE } from './ddc-helper-source.js';
import { MacOsDdcBridge } from './macos-bridge.js';

const run = promisify(execFile);

export class MacOsHelperBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacOsHelperBuildError';
  }
}

/**
 * Compiles the embedded helper once and caches it by source hash.
 *
 * clang ships with the Xcode Command Line Tools, which any Mac used for
 * development already has. If it is missing we say exactly what to install
 * rather than reporting the monitors as unreachable.
 */
async function helperPath(): Promise<string> {
  const digest = createHash('sha256').update(MACOS_DDC_HELPER_SOURCE).digest('hex').slice(0, 12);
  const directory = join(tmpdir(), 'desk-control');
  const binary = join(directory, `ddc-helper-${digest}`);
  if (existsSync(binary)) return binary;

  await mkdir(directory, { recursive: true });
  const source = join(directory, `ddc-helper-${digest}.c`);
  await writeFile(source, MACOS_DDC_HELPER_SOURCE, 'utf8');

  try {
    await run('clang', [
      '-O2',
      '-Wall',
      '-o',
      binary,
      source,
      '-framework',
      'IOKit',
      '-framework',
      'CoreFoundation',
    ]);
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr ?? (error as Error).message;
    if (/ENOENT/.test(detail) || /not found/i.test(detail)) {
      throw new MacOsHelperBuildError(
        'clang was not found. Install the Xcode Command Line Tools with: xcode-select --install',
      );
    }
    throw new MacOsHelperBuildError(`Failed to build the macOS DDC helper.\n${detail}`);
  }

  return binary;
}

export function createMacOsDdcBridge(): DdcBridge {
  const raw = new JsonLineProcessBridge({
    name: 'macOS DDC helper',
    // Plain text out, JSON back: see ddc-helper-source.ts.
    encodeRequest(id, op, params) {
      switch (op) {
        case 'read':
          return `${id} read ${String(params.deviceId)} ${Number(params.length)}`;
        case 'write':
          return `${id} write ${String(params.deviceId)} ${String(params.payloadHex)}`;
        default:
          return `${id} ${op}`;
      }
    },
    async resolveCommand() {
      return { command: await helperPath(), args: [] };
    },
  });

  return new MacOsDdcBridge({ raw });
}

export interface MacOsDdcProviderOptions {
  bridge?: DdcBridge;
  verifyIntervalMs?: number;
}

/**
 * macOS monitor control.
 *
 * Identical behaviour to the Windows provider - the shared DdcMonitorControlProvider
 * does the work - over a different transport. In particular a panel discovered
 * here produces the same EDID-derived stable id a Windows agent produces, which
 * is what lets the controller merge the two into one monitor with two control
 * paths.
 */
export class MacOsDdcMonitorControlProvider extends DdcMonitorControlProvider {
  constructor(options: MacOsDdcProviderOptions = {}) {
    super({
      kind: 'macos-ddc',
      bridge: options.bridge ?? createMacOsDdcBridge(),
      ...(options.verifyIntervalMs === undefined
        ? {}
        : { verifyIntervalMs: options.verifyIntervalMs }),
    });
  }
}
