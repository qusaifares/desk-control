import { describe, expect, it } from 'vitest';
import { migrateDeskConfig } from './migrate.js';
import { DeskConfigSchema } from './schema.js';
import { emptyDeskConfig } from './empty-desk.js';

/** A real v1 config, as written by the version of this app that shipped it. */
const V1_CONFIG = {
  configVersion: 1,
  controller: { id: 'controller:local', name: 'Desk Controller' },
  layout: { id: 'layout:default', name: 'My desk', grid: { columns: 16, rows: 9 }, placements: {} },
  presets: [],
  customNames: {
    computers: { 'computer:qusaipc': 'Battlestation' },
    monitors: { 'monitor:aus:pa278cv:n6lmqs137321': 'Top' },
    monitorInputs: { 'monitor:aus:pa278cv:n6lmqs137321:input-0x11': 'Console port' },
    peripherals: {},
  },
  peripherals: [],
  peripheralSwitches: [],
  wiringOverrides: {},
  manualComputers: [],
};

describe('migrateDeskConfig', () => {
  it('collapses v1 customNames into one overrides record', () => {
    const { config, applied } = migrateDeskConfig(V1_CONFIG);
    expect(applied).toEqual([1]);

    const parsed = DeskConfigSchema.parse(config);
    expect(parsed.configVersion).toBe(2);
    expect(parsed.overrides['computer:qusaipc']?.customName).toBe('Battlestation');
    expect(parsed.overrides['monitor:aus:pa278cv:n6lmqs137321']?.customName).toBe('Top');
    // Composite monitor-input keys survive unchanged.
    expect(parsed.overrides['monitor:aus:pa278cv:n6lmqs137321:input-0x11']?.customName).toBe(
      'Console port',
    );
  });

  it('drops the old structure rather than leaving both shapes behind', () => {
    const { config } = migrateDeskConfig(V1_CONFIG);
    expect(config).not.toHaveProperty('customNames');
  });

  it('preserves everything it does not touch', () => {
    const withData = {
      ...V1_CONFIG,
      wiringOverrides: { 'monitor:a': { 'input-0x11': 'computer:manual:ps5' } },
      manualComputers: [{ id: 'computer:manual:ps5', detectedName: 'PS5', platform: 'unknown' }],
    };
    const parsed = DeskConfigSchema.parse(migrateDeskConfig(withData).config);
    expect(parsed.wiringOverrides).toEqual(withData.wiringOverrides);
    expect(parsed.manualComputers).toEqual(withData.manualComputers);
  });

  it('leaves a current config completely alone', () => {
    const current = emptyDeskConfig();
    const { config, applied } = migrateDeskConfig(current);
    expect(applied).toEqual([]);
    expect(config).toEqual(current);
  });

  it('treats a config with no version as v1', () => {
    const { configVersion: _omitted, ...unversioned } = V1_CONFIG;
    const { applied } = migrateDeskConfig(unversioned);
    expect(applied).toEqual([1]);
  });

  it('ignores an empty or malformed name instead of writing a broken override', () => {
    const messy = {
      ...V1_CONFIG,
      customNames: { computers: { 'computer:a': '', 'computer:b': null }, monitors: {} },
    };
    const parsed = DeskConfigSchema.parse(migrateDeskConfig(messy).config);
    expect(parsed.overrides).toEqual({});
  });

  it('passes non-objects through untouched rather than throwing', () => {
    expect(migrateDeskConfig(null).config).toBeNull();
    expect(migrateDeskConfig('nonsense').config).toBe('nonsense');
  });
});
