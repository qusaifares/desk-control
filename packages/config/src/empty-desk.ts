import type { DeskConfig } from './schema.js';

/**
 * First-run config for a real desk.
 *
 * Deliberately empty: no monitors, no presets, no invented names. Real hardware
 * arrives from agents, and the controller places each monitor on the map as it
 * is discovered. Seeding a fictional four-monitor desk on someone's real
 * machine would be worse than showing nothing.
 */
export function emptyDeskConfig(): DeskConfig {
  return {
    configVersion: 2,
    controller: { id: 'controller:local', name: 'Desk Controller' },
    layout: {
      id: 'layout:default',
      name: 'My desk',
      grid: { columns: 16, rows: 9 },
      placements: {},
    },
    presets: [],
    overrides: {},
    peripherals: [],
    peripheralSwitches: [],
    wiringOverrides: {},
    manualComputers: [],
  };
}
