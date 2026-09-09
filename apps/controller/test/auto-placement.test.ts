import { emptyDeskConfig } from '@desk-control/config';
import type { MonitorReport } from '@desk-control/protocol';
import { describe, expect, it } from 'vitest';
import { DeskStore } from '../src/desk-store.js';

function report(stableId: string, overrides: Partial<MonitorReport> = {}): MonitorReport {
  return {
    stableId,
    localHandle: `handle:${stableId}`,
    detectedName: stableId,
    identity: {
      manufacturerId: 'AUS',
      model: 'X',
      serial: stableId,
      manufactureYear: 2024,
      weakIdentity: false,
    },
    capabilities: ['input-switch'],
    inputs: [
      {
        id: 'input-0x0f',
        connector: 'DisplayPort',
        ddcInputSourceValue: 0x0f,
        detectedName: 'DisplayPort 1',
        maxMode: null,
      },
    ],
    connectedViaInputId: 'input-0x0f',
    requiresActiveInput: true,
    preferredInputId: null,
    ...overrides,
  };
}

describe('auto placement on a fresh desk', () => {
  it('gives every discovered monitor a spot instead of leaving the map empty', () => {
    const store = new DeskStore(emptyDeskConfig());
    store.applyMonitorReports('agent:a', 'computer:a', [report('monitor:1'), report('monitor:2')]);

    const first = store.monitors.get('monitor:1')?.placement;
    const second = store.monitors.get('monitor:2')?.placement;

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.autoPlaced).toBe(true);
    // Laid out left to right without overlapping.
    expect(second!.x).toBeGreaterThanOrEqual(first!.x + first!.width);
  });

  it('grows the grid so auto-placed monitors stay inside the map', () => {
    const store = new DeskStore(emptyDeskConfig());
    store.applyMonitorReports('agent:a', 'computer:a', [
      report('monitor:1'),
      report('monitor:2'),
      report('monitor:3'),
    ]);

    const rightmost = Math.max(
      ...[...store.monitors.values()].map((m) => m.placement!.x + m.placement!.width),
    );
    expect(store.config.layout.grid.columns).toBeGreaterThanOrEqual(rightmost);
  });

  it('never moves a monitor the user has already arranged', () => {
    const config = emptyDeskConfig();
    config.layout.placements['monitor:1'] = {
      x: 4,
      y: 2,
      width: 9,
      height: 16,
      orientation: 'portrait-left',
      autoPlaced: false,
    };
    const store = new DeskStore(config);
    store.applyMonitorReports('agent:a', 'computer:a', [report('monitor:1')]);

    expect(store.monitors.get('monitor:1')?.placement).toEqual({
      x: 4,
      y: 2,
      width: 9,
      height: 16,
      orientation: 'portrait-left',
      autoPlaced: false,
    });
  });

  it('re-discovery does not shuffle an already placed desk', () => {
    const store = new DeskStore(emptyDeskConfig());
    store.applyMonitorReports('agent:a', 'computer:a', [report('monitor:1'), report('monitor:2')]);
    const before = JSON.stringify(store.config.layout.placements);

    store.applyMonitorReports('agent:a', 'computer:a', [report('monitor:1'), report('monitor:2')]);
    expect(JSON.stringify(store.config.layout.placements)).toBe(before);
  });
});
