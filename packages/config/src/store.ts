import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { migrateDeskConfig } from './migrate.js';
import { DeskConfigSchema, type DeskConfig } from './schema.js';

/**
 * Why JSON and not SQLite
 * ----------------------
 * The persisted set is tens of entities of user intent - layout, labels,
 * presets. There is no query workload, no concurrent writer, and the whole file
 * is read into memory at boot anyway. JSON gives us: a human-readable,
 * hand-editable, git-diffable config; trivial backup; and - importantly for the
 * Raspberry Pi ARM64 target - zero native modules to rebuild per Node ABI.
 *
 * SQLite becomes the right answer the day we keep history (switch logs, per-app
 * usage, telemetry over time). The store interface below is the seam for that.
 */
export interface ConfigStore {
  load(): Promise<DeskConfig | null>;
  save(config: DeskConfig): Promise<void>;
}

export class JsonFileConfigStore implements ConfigStore {
  constructor(private readonly filePath: string) {}

  private get backupPath(): string {
    return `${this.filePath}.bak`;
  }

  async load(): Promise<DeskConfig | null> {
    const primary = await this.tryLoad(this.filePath);
    if (primary.kind === 'ok') return primary.config;
    if (primary.kind === 'missing') {
      // Losing the main file but keeping the backup is exactly what an
      // interrupted write looks like. Prefer the backup over starting empty.
      const backup = await this.tryLoad(this.backupPath);
      if (backup.kind === 'ok') return backup.config;
      return null;
    }

    // The main file exists and is unreadable. Quarantine it, then fall back.
    const quarantine = `${this.filePath}.invalid-${Date.now()}`;
    await rename(this.filePath, quarantine).catch(() => {});
    const backup = await this.tryLoad(this.backupPath);
    if (backup.kind === 'ok') return backup.config;
    throw new InvalidConfigError(quarantine, primary.detail);
  }

  private async tryLoad(
    path: string,
  ): Promise<
    { kind: 'ok'; config: DeskConfig } | { kind: 'missing' } | { kind: 'invalid'; detail: string }
  > {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      throw error;
    }

    try {
      const migrated = migrateDeskConfig(JSON.parse(raw));
      const parsed = DeskConfigSchema.safeParse(migrated.config);
      if (!parsed.success) return { kind: 'invalid', detail: parsed.error.message };
      return { kind: 'ok', config: parsed.data };
    } catch (error) {
      return { kind: 'invalid', detail: (error as Error).message };
    }
  }

  /**
   * Atomic *and* durable.
   *
   * A plain write-then-rename is atomic but not durable: the rename can reach
   * the directory before the file's contents reach the disk, so an SD card
   * losing power mid-write can leave an empty or truncated config where a good
   * one used to be. The Pi this runs on loses power without warning, and this
   * file is the only thing on it that cannot be re-derived from hardware.
   *
   * So: fsync the contents before the rename, keep the previous good copy as a
   * backup, and fsync the directory afterwards so the rename itself survives.
   */
  async save(config: DeskConfig): Promise<void> {
    DeskConfigSchema.parse(config);
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });

    const temporary = join(directory, `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);

    const handle = await open(temporary, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Copy rather than rename, so there is never a moment with no config at all.
    await copyFile(this.filePath, this.backupPath).catch(() => {});

    await rename(temporary, this.filePath);
    await syncDirectory(directory);
  }
}

/**
 * Makes a rename durable. Best effort: Windows cannot open a directory this
 * way, and the guarantee is only needed on the Pi.
 */
async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // Not supported here; the contents fsync above is still the important half.
  } finally {
    await handle?.close().catch(() => {});
  }
}

export class InMemoryConfigStore implements ConfigStore {
  constructor(private current: DeskConfig | null = null) {}

  async load(): Promise<DeskConfig | null> {
    return this.current;
  }

  async save(config: DeskConfig): Promise<void> {
    this.current = DeskConfigSchema.parse(config);
  }
}

export class InvalidConfigError extends Error {
  constructor(
    readonly quarantinePath: string,
    readonly detail: string,
  ) {
    super(
      `Desk config was invalid and has been moved to ${quarantinePath}. Falling back to defaults. ${detail}`,
    );
    this.name = 'InvalidConfigError';
  }
}
