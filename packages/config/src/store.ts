import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

  async load(): Promise<DeskConfig | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    // Migrate before validating: an older config does not satisfy the current
    // schema by definition.
    const migrated = migrateDeskConfig(JSON.parse(raw));
    const parsed = DeskConfigSchema.safeParse(migrated.config);
    if (!parsed.success) {
      // Never silently discard a user's desk. Keep the bad file aside so it can
      // be inspected, and let the caller fall back to defaults.
      const quarantine = `${this.filePath}.invalid-${Date.now()}`;
      await rename(this.filePath, quarantine);
      throw new InvalidConfigError(quarantine, parsed.error.message);
    }
    return parsed.data;
  }

  /** Atomic: write a temp file next to the target, then rename over it. */
  async save(config: DeskConfig): Promise<void> {
    DeskConfigSchema.parse(config);
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = join(
      dirname(this.filePath),
      `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filePath);
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
