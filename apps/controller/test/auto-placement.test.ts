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

describe('placement from the OS desktop arrangement', () => {
  // Captured from a real Windows desk; see arrangement.test.ts in domain.
  const portrait = report('monitor:portrait', {
    identity: { ...report('x').identity, physicalSizeInches: 27 },
    desktopBounds: { x: -1440, y: -1403, width: 1440, height: 2560, rotation: 90 },
  });
  const top = report('monitor:top', {
    identity: { ...report('x').identity, physicalSizeInches: 27 },
    desktopBounds: { x: 0, y: -2160, width: 3840, height: 2160, rotation: 0 },
  });
  const bottom = report('monitor:bottom', {
    identity: { ...report('x').identity, physicalSizeInches: 27 },
    desktopBounds: { x: 0, y: 0, width: 2560, height: 1440, rotation: 0 },
  });

  const placementOf = (store: DeskStore, id: string) => store.monitors.get(id)!.placement!;

  it('lays a fresh desk out the way Windows has it, portrait included', () => {
    const store = new DeskStore(emptyDeskConfig());
    store.applyMonitorReports('agent:a', 'computer:a', [top, bottom, portrait]);

    const left = placementOf(store, 'monitor:portrait');
    const upper = placementOf(store, 'monitor:top');
    const lower = placementOf(store, 'monitor:bottom');
    expect(left.orientation).toBe('portrait-left');
    expect(upper.x).toBe(left.x + left.width);
    expect(lower.y).toBe(upper.y + upper.height);
    expect(upper.autoBasis).toBe('os-arrangement');
    expect(store.config.layout.grid).toEqual({
      columns: upper.x + upper.width,
      rows: lower.y + lower.height,
    });
  });

  it('replaces a discovery-order guess once an arrangement arrives', () => {
    const store = new DeskStore(emptyDeskConfig());
    const withoutBounds = [top, bottom, portrait].map((entry) => ({
      ...entry,
      desktopBounds: null,
    }));
    store.applyMonitorReports('agent:a', 'computer:a', withoutBounds);
    expect(placementOf(store, 'monitor:portrait').orientation).toBe('landscape');

    store.applyMonitorReports('agent:a', 'computer:a', [top, bottom, portrait]);
    expect(placementOf(store, 'monitor:portrait').orientation).toBe('portrait-left');
  });

  it('keeps an arranged desk still when a second computer arranges it differently', () => {
    const store = new DeskStore(emptyDeskConfig());
    store.applyMonitorReports('agent:a', 'computer:a', [top, bottom]);
    const before = JSON.stringify(store.config.layout.placements);

    // Computer B has the same two side by side.
    store.applyMonitorReports('agent:b', 'computer:b', [
      { ...top, desktopBounds: { x: 0, y: 0, width: 3840, height: 2160, rotation: 0 } },
      { ...bottom, desktopBounds: { x: 3840, y: 0, width: 2560, height: 1440, rotation: 0 } },
    ]);
    expect(JSON.stringify(store.config.layout.placements)).toBe(before);
  });

  it('never moves a monitor the user placed, and arranges new ones around it', () => {
    const config = emptyDeskConfig();
    config.layout.placements['monitor:bottom'] = {
      x: 40,
      y: 30,
      width: 23.5,
      height: 13.5,
      orientation: 'landscape',
      autoPlaced: false,
    };
    const store = new DeskStore(config);
    store.applyMonitorReports('agent:a', 'computer:a', [top, bottom]);

    const lower = placementOf(store, 'monitor:bottom');
    const upper = placementOf(store, 'monitor:top');
    expect(lower).toMatchObject({ x: 40, y: 30, autoPlaced: false });
    expect(upper.x).toBe(40);
    expect(upper.y + upper.height).toBe(30);
  });

  it('auto-arrange throws away the user layout and rebuilds it', () => {
    const store = new DeskStore(emptyDeskConfig());
    store.applyMonitorReports('agent:a', 'computer:a', [top, bottom, portrait]);
    const arranged = JSON.stringify(store.config.layout.placements);

    store.setPlacement('monitor:portrait', {
      x: 60,
      y: 0,
      width: 23.5,
      height: 13,
      orientation: 'landscape',
      autoPlaced: false,
    });
    store.resetLayout();
    expect(JSON.stringify(store.config.layout.placements)).toBe(arranged);
  });
});
