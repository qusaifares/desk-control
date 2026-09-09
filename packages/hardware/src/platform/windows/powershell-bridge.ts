import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DDC_BRIDGE_SCRIPT } from './ddc-bridge-script.js';

export interface BridgeError {
  code: string;
  message: string;
}

export interface DdcBridge {
  request<TResult>(
    op: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<TResult>;
  dispose(): Promise<void>;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class BridgeRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeRequestError';
  }
}

/** True when this Node process is running inside WSL rather than on Windows. */
export function isWsl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

/**
 * powershell.exe needs a Windows path. Under WSL the script lives on the Linux
 * filesystem, so translate it; running natively on Windows the path is already
 * correct.
 */
function toWindowsPath(path: string): string {
  if (!isWsl()) return path;
  return execFileSync('wslpath', ['-w', path], { encoding: 'utf8' }).trim();
}

function powershellExecutable(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  // Under WSL, interop puts the Windows binary on PATH.
  return 'powershell.exe';
}

/**
 * Long-lived PowerShell host speaking one JSON object per line.
 *
 * The process is started lazily and restarted on demand: if it dies (a display
 * driver reset can take it down), the next request brings up a fresh one rather
 * than failing forever. In-flight requests are rejected rather than left
 * hanging, so a command surfaces as a failure instead of a timeout.
 */
export class PowerShellDdcBridge implements DdcBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private buffer = '';
  private counter = 0;
  private disposed = false;

  constructor(private readonly startupTimeoutMs = 20_000) {}

  private async scriptPath(): Promise<string> {
    const digest = createHash('sha256').update(DDC_BRIDGE_SCRIPT).digest('hex').slice(0, 12);
    const directory = join(tmpdir(), 'desk-control');
    const path = join(directory, `ddc-bridge-${digest}.ps1`);
    if (!existsSync(path)) {
      await mkdir(directory, { recursive: true });
      // BOM so PowerShell reads it as UTF-8 regardless of console codepage.
      await writeFile(path, `\ufeff${DDC_BRIDGE_SCRIPT}`, 'utf8');
    }
    return path;
  }

  private async ensureStarted(): Promise<void> {
    if (this.disposed) throw new BridgeRequestError('INTERNAL', 'Bridge has been disposed');
    if (this.child) return;
    if (this.starting) return this.starting;

    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const script = toWindowsPath(await this.scriptPath());
    const child = spawn(
      powershellExecutable(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf8');

    let stderr = '';
    child.stderr.on('data', (chunk: string) => {
      // Kept for the error message only; the protocol never uses stderr.
      stderr = `${stderr}${chunk}`.slice(-4000);
    });

    const exited = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) => reject(error));
      child.once('exit', (code) => {
        this.child = null;
        const failure = new BridgeRequestError(
          'DEVICE_UNREACHABLE',
          `DDC bridge exited (code ${code}). ${stderr.trim()}`.trim(),
        );
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(failure);
          this.pending.delete(id);
        }
        reject(failure);
      });
    });

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new BridgeRequestError(
            'TIMEOUT',
            `DDC bridge did not become ready within ${this.startupTimeoutMs}ms`,
          ),
        );
      }, this.startupTimeoutMs);
      this.pending.set('ready', {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
    });

    this.child = child;
    await Promise.race([ready, exited]);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let message: { id?: string; ok?: boolean; result?: unknown; error?: BridgeError };
    try {
      message = JSON.parse(line);
    } catch {
      // A frame we cannot parse is dropped; the request's own timeout applies.
      return;
    }

    const id = message.id;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);

    if (message.ok) pending.resolve(message.result);
    else {
      pending.reject(
        new BridgeRequestError(
          message.error?.code ?? 'INTERNAL',
          message.error?.message ?? 'DDC bridge reported an unspecified failure',
        ),
      );
    }
  }

  async request<TResult>(
    op: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<TResult> {
    await this.ensureStarted();
    const child = this.child;
    if (!child) throw new BridgeRequestError('DEVICE_UNREACHABLE', 'DDC bridge is not running');

    this.counter += 1;
    const id = `r${this.counter}`;

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeRequestError('TIMEOUT', `DDC operation "${op}" timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      });

      child.stdin.write(`${JSON.stringify({ id, op, ...params })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new BridgeRequestError('DEVICE_UNREACHABLE', error.message));
      });
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.stdin.end();
    // Give PowerShell a moment to exit its read loop before forcing it.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
