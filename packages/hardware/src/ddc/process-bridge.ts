import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { DdcBridge } from './types.js';

export interface BridgeError {
  code: string;
  message: string;
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
 * Translates a Linux path for a Windows binary. Under WSL the helper script
 * lives on the Linux filesystem but powershell.exe needs a Windows path;
 * running natively on Windows the path is already correct.
 */
export function toWindowsPath(path: string): string {
  if (!isWsl()) return path;
  return execFileSync('wslpath', ['-w', path], { encoding: 'utf8' }).trim();
}

export interface ProcessBridgeOptions {
  /** Used in error messages, e.g. "Windows DDC bridge". */
  name: string;
  /**
   * Produces the command to spawn. Called on every (re)start, so a helper that
   * needs compiling or writing to disk can do that here, once, and cache.
   */
  resolveCommand(): Promise<{ command: string; args: string[] }>;
  startupTimeoutMs?: number;
  /**
   * Encodes an outgoing request line. Defaults to JSON.
   *
   * The macOS helper overrides this with a plain-text form, because writing a
   * JSON parser in C to read our own fixed request shapes would be all risk and
   * no benefit. Replies are JSON in both directions - emitting JSON is easy
   * anywhere, parsing it is not.
   */
  encodeRequest?(id: string, op: string, params: Record<string, unknown>): string;
}

/**
 * A long-lived helper process speaking one JSON object per line.
 *
 * Both platform helpers use this: the expensive setup - compiling a P/Invoke
 * type, opening IOKit services - happens once at startup, after which each
 * operation costs a line in and a line out.
 *
 * The process starts lazily and restarts on demand. If it dies (a display
 * driver reset can take it down) the next request brings up a fresh one rather
 * than failing forever, and in-flight requests are rejected rather than left to
 * hang, so a command surfaces as a failure instead of a timeout.
 */
export class JsonLineProcessBridge implements DdcBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private buffer = '';
  private counter = 0;
  private disposed = false;

  constructor(private readonly options: ProcessBridgeOptions) {}

  private get startupTimeoutMs(): number {
    return this.options.startupTimeoutMs ?? 20_000;
  }

  private async ensureStarted(): Promise<void> {
    if (this.disposed)
      throw new BridgeRequestError('INTERNAL', `${this.options.name} was disposed`);
    if (this.child) return;
    if (this.starting) return this.starting;

    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const { command, args } = await this.options.resolveCommand();
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf8');

    let stderr = '';
    child.stderr.on('data', (chunk: string) => {
      // Kept for error messages only; the protocol never uses stderr.
      stderr = `${stderr}${chunk}`.slice(-4000);
    });

    const exited = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) => reject(error));
      child.once('exit', (code) => {
        this.child = null;
        const failure = new BridgeRequestError(
          'DEVICE_UNREACHABLE',
          `${this.options.name} exited (code ${code}). ${stderr.trim()}`.trim(),
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
            `${this.options.name} did not become ready within ${this.startupTimeoutMs}ms`,
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
          message.error?.message ?? `${this.options.name} reported an unspecified failure`,
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
    if (!child) {
      throw new BridgeRequestError('DEVICE_UNREACHABLE', `${this.options.name} is not running`);
    }

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

      const line = this.options.encodeRequest
        ? this.options.encodeRequest(id, op, params)
        : JSON.stringify({ id, op, ...params });

      child.stdin.write(`${line}\n`, (error) => {
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
    // Give the helper a moment to leave its read loop before forcing it.
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
