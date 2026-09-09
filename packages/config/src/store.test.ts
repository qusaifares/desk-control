import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    expect(raw).toContain('\n  "configVersion": 1');
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
