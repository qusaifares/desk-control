import { emptyDeskConfig } from '@desk-control/config';
import type { MonitorReport } from '@desk-control/protocol';
import { describe, expect, it, vi } from 'vitest';
import { DeskStore } from '../src/desk-store.js';

const MONITOR = 'monitor:aus:pa279cv:383842';

function report(): MonitorReport {
  return {
    stableId: MONITOR,
    localHandle: 'handle',
    detectedName: 'AUS PA279CV',
    identity: {
      manufacturerId: 'AUS',
      model: 'PA279CV',
      serial: '383842',
      manufactureYear: 2021,
      weakIdentity: false,
      physicalSizeInches: 27,
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
      {
        id: 'input-0x11',
        connector: 'HDMI',
        ddcInputSourceValue: 0x11,
        detectedName: 'HDMI 1',
        maxMode: null,
      },
    ],
    connectedViaInputId: 'input-0x0f',
    requiresActiveInput: true,
    preferredInputId: null,
  };
}

function storeWithOneAgent() {
  const store = new DeskStore(emptyDeskConfig());
  store.applyMonitorReports('agent:pc', 'computer:pc', [report()]);
  return store;
}

describe('persisting user edits', () => {
  it('signals a config write on every kind of edit', () => {
    const store = storeWithOneAgent();
    const onConfigChange = vi.fn();
    store.subscribeConfig(onConfigChange);

    store.setCustomName('monitor', MONITOR, 'Right Rail');
    store.setPlacement(MONITOR, {
      x: 2,
      y: 1,
      width: 9,
      height: 16,
      orientation: 'portrait-left',
      autoPlaced: false,
    });
    const declared = store.declareComputer('PlayStation', 'unknown');
    store.setWiringOverride(MONITOR, 'input-0x11', declared.id);

    // Without this, a Pi losing power loses every edit made since boot.
    expect(onConfigChange).toHaveBeenCalledTimes(4);
  });
});

describe('arranging the desk', () => {
  it('records a move and stops calling the monitor auto-placed', () => {
    const store = storeWithOneAgent();
    expect(store.monitors.get(MONITOR)?.placement?.autoPlaced).toBe(true);

    store.setPlacement(MONITOR, {
      x: 3,
      y: 2,
      width: 9,
      height: 16,
      orientation: 'portrait-left',
      autoPlaced: false,
    });

    const placement = store.monitors.get(MONITOR)?.placement;
    expect(placement).toMatchObject({
      x: 3,
      y: 2,
      orientation: 'portrait-left',
      autoPlaced: false,
    });
    expect(store.config.layout.placements[MONITOR]).toEqual(placement);
  });

  it('grows the grid so a monitor moved outward stays on the map', () => {
    const store = storeWithOneAgent();
    store.setPlacement(MONITOR, {
      x: 40,
      y: 0,
      width: 16,
      height: 9,
      orientation: 'landscape',
      autoPlaced: false,
    });
    expect(store.config.layout.grid.columns).toBeGreaterThanOrEqual(56);
  });

  it('survives a re-discovery without snapping back', () => {
    const store = storeWithOneAgent();
    store.setPlacement(MONITOR, {
      x: 5,
      y: 5,
      width: 9,
      height: 16,
      orientation: 'portrait-right',
      autoPlaced: false,
    });
    store.applyMonitorReports('agent:pc', 'computer:pc', [report()]);
    expect(store.monitors.get(MONITOR)?.placement).toMatchObject({ x: 5, y: 5 });
  });
});

describe('declaring a computer that has no agent', () => {
  it('creates a routable source with an unknown, not offline, connectivity', () => {
    const store = storeWithOneAgent();
    const declared = store.declareComputer('PlayStation 5', 'unknown');

    expect(declared.id).toBe('computer:manual:playstation-5');
    // It was never expected to check in, so calling it offline would be a lie.
    expect(declared.connectivity.state).toBe('unknown');
    expect(store.config.manualComputers).toHaveLength(1);
  });

  it('is remembered across a restart', () => {
    const store = storeWithOneAgent();
    store.declareComputer('PlayStation 5', 'unknown');

    const restarted = new DeskStore(store.config);
    expect(restarted.computers.get('computer:manual:playstation-5')?.detectedName).toBe(
      'PlayStation 5',
    );
  });
});

describe('wiring overrides', () => {
  it('teaches the controller about an input no agent can report', () => {
    const store = storeWithOneAgent();
    // Only the PC has an agent, so HDMI 1 is a blank as far as discovery goes.
    expect(
      store.monitors.get(MONITOR)?.inputs.find((i) => i.id === 'input-0x11')?.connectedComputerId,
    ).toBeNull();

    const declared = store.declareComputer('PlayStation 5', 'unknown');
    expect(store.setWiringOverride(MONITOR, 'input-0x11', declared.id)).toBe(true);

    expect(
      store.monitors.get(MONITOR)?.inputs.find((i) => i.id === 'input-0x11')?.connectedComputerId,
    ).toBe(declared.id);
  });

  it('wins over what discovery inferred, and survives re-discovery', () => {
    const store = storeWithOneAgent();
    const declared = store.declareComputer('Media box', 'unknown');
    store.setWiringOverride(MONITOR, 'input-0x0f', declared.id);

    // The agent keeps insisting it is on DisplayPort; the user says otherwise.
    store.applyMonitorReports('agent:pc', 'computer:pc', [report()]);
    expect(
      store.monitors.get(MONITOR)?.inputs.find((i) => i.id === 'input-0x0f')?.connectedComputerId,
    ).toBe(declared.id);
  });

  it('clears back to discovery when the override is removed', () => {
    const store = storeWithOneAgent();
    const declared = store.declareComputer('Media box', 'unknown');
    store.setWiringOverride(MONITOR, 'input-0x0f', declared.id);
    store.setWiringOverride(MONITOR, 'input-0x0f', null);

    expect(store.config.wiringOverrides[MONITOR]).toBeUndefined();
    store.applyMonitorReports('agent:pc', 'computer:pc', [report()]);
    expect(
      store.monitors.get(MONITOR)?.inputs.find((i) => i.id === 'input-0x0f')?.connectedComputerId,
    ).toBe('computer:pc');
  });

  it('refuses to wire a computer the desk has never heard of', () => {
    const store = storeWithOneAgent();
    expect(store.setWiringOverride(MONITOR, 'input-0x11', 'computer:ghost')).toBe(false);
  });

  it('refuses an input the monitor does not have', () => {
    const store = storeWithOneAgent();
    const declared = store.declareComputer('Media box', 'unknown');
    expect(store.setWiringOverride(MONITOR, 'input-0xff', declared.id)).toBe(false);
  });
});
