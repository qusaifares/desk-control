import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyDeskConfig } from './empty-desk.js';
import { exampleDeskConfig } from './example-desk.js';
import { DeskConfigSchema } from './schema.js';
import { InvalidConfigError, JsonFileConfigStore } from './store.js';

async function tempStore() {
  const directory = await mkdtemp(join(tmpdir(), 'desk-control-'));
  const path = join(directory, 'desk-config.json');
  return { path, store: new JsonFileConfigStore(path) };
}

describe('JsonFileConfigStore', () => {
  it('returns null rather than throwing on first run', async () => {
    const { store } = await tempStore();
    expect(await store.load()).toBeNull();
  });

  it('round-trips a config through disk', async () => {
    const { store } = await tempStore();
    const config = exampleDeskConfig();
    await store.save(config);
    expect(await store.load()).toEqual(config);
  });

  it('writes human-editable JSON', async () => {
    const { path, store } = await tempStore();
    await store.save(exampleDeskConfig());
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain(`\n  "configVersion": 2`);
  });

  it('quarantines an invalid config instead of destroying it', async () => {
    const { path, store } = await tempStore();
    await writeFile(path, JSON.stringify({ configVersion: 99 }), 'utf8');
    await expect(store.load()).rejects.toBeInstanceOf(InvalidConfigError);
  });
});

describe('example desk seed data', () => {
  it('is a valid config', () => {
    expect(() => DeskConfigSchema.parse(exampleDeskConfig())).not.toThrow();
  });

  it('only assigns presets to monitors that exist in the layout', () => {
    const config = exampleDeskConfig();
    const placed = new Set(Object.keys(config.layout.placements));
    for (const preset of config.presets) {
      for (const monitorId of Object.keys(preset.assignments.monitorSources)) {
        expect(placed.has(monitorId)).toBe(true);
      }
    }
  });
});

describe('empty desk seed', () => {
  it('invents nothing: no monitors, no presets, no names', () => {
    const config = emptyDeskConfig();
    expect(() => DeskConfigSchema.parse(config)).not.toThrow();
    expect(config.presets).toEqual([]);
    expect(config.layout.placements).toEqual({});
    expect(config.overrides).toEqual({});
    expect(config.peripherals).toEqual([]);
  });
});

describe('surviving a power cut', () => {
  it('keeps the previous good config as a backup', async () => {
    const { path, store } = await tempStore();
    const first = exampleDeskConfig();
    await store.save(first);

    const second = { ...first, controller: { ...first.controller, name: 'Renamed' } };
    await store.save(second);

    const backup = JSON.parse(await readFile(`${path}.bak`, 'utf8')) as {
      controller: { name: string };
    };
    expect(backup.controller.name).toBe('Desk Controller');
    expect((await store.load())?.controller.name).toBe('Renamed');
  });

  it('falls back to the backup when the main file is lost mid-write', async () => {
    const { path, store } = await tempStore();
    await store.save(exampleDeskConfig());
    await store.save(exampleDeskConfig());

    // What an interrupted rename leaves behind: backup present, target gone.
    await rm(path);
    expect((await store.load())?.controller.name).toBe('Desk Controller');
  });

  it('falls back to the backup when the main file is truncated', async () => {
    const { path, store } = await tempStore();
    await store.save(exampleDeskConfig());
    await store.save(exampleDeskConfig());

    // A half-flushed SD card write looks exactly like this.
    await writeFile(path, '{"configVersion": 2, "cont', 'utf8');
    const loaded = await store.load();
    expect(loaded?.controller.name).toBe('Desk Controller');

    // The unreadable file is kept for inspection, not deleted.
    const quarantined = (await readdir(dirname(path))).filter((name) => name.includes('.invalid-'));
    expect(quarantined).toHaveLength(1);
  });

  it('still reports an unreadable config when there is no backup to fall back on', async () => {
    const { path, store } = await tempStore();
    await writeFile(path, 'not json at all', 'utf8');
    await expect(store.load()).rejects.toBeInstanceOf(InvalidConfigError);
  });
});
