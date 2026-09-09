import type { DeskSnapshot, Monitor, SyncStatus } from '@desk-control/domain';

/**
 * Snapshot builders for UI tests.
 *
 * The UI renders whatever the controller sends, so a test only needs to state
 * the part of the snapshot it cares about. Everything else gets a boring valid
 * default here.
 */
export const testMonitor: Monitor = {
  id: 'monitor:1',
  kind: 'monitor',
  detectedName: 'ASUS XG27AQM',
  customName: 'Top',
  identity: {
    manufacturerId: 'AUS',
    model: 'XG27AQM',
    serial: '0001',
    manufactureYear: 2022,
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
      customName: null,
      connectedComputerId: 'computer:pc',
      maxMode: null,
    },
    {
      id: 'input-0x11',
      connector: 'HDMI',
      ddcInputSourceValue: 0x11,
      detectedName: 'HDMI 1',
      customName: null,
      connectedComputerId: 'computer:mac',
      maxMode: null,
    },
  ],
  controlPaths: [],
  preferredInputId: null,
  placement: { x: 0, y: 0, width: 10, height: 10, orientation: 'landscape', autoPlaced: false },
};

export function makeSnapshot(options: {
  status?: SyncStatus;
  observedId?: string | null;
  desiredId?: string | null;
  lastKnownId?: string | null;
  monitors?: Monitor[];
}): DeskSnapshot {
  const monitors = options.monitors ?? [testMonitor];
  return {
    revision: 1,
    updatedAt: new Date().toISOString(),
    controller: {
      id: 'controller:1',
      name: 'Desk',
      version: '0.1.0',
      protocolVersion: 1,
      startedAt: new Date().toISOString(),
    },
    layout: { id: 'l', name: 'l', grid: { columns: 10, rows: 10 }, placements: {} },
    computers: [
      {
        id: 'computer:pc',
        kind: 'computer',
        detectedName: 'DESKTOP',
        customName: 'Gaming PC',
        platform: 'windows',
        capabilities: [],
        agentId: null,
        connectivity: { state: 'online', lastSeenAt: null },
        metadata: {},
      },
      {
        id: 'computer:mac',
        kind: 'computer',
        detectedName: 'MBP',
        customName: 'M4 MacBook',
        platform: 'macos',
        capabilities: [],
        agentId: null,
        connectivity: { state: 'online', lastSeenAt: null },
        metadata: {},
      },
    ],
    agents: [],
    monitors,
    peripherals: [],
    peripheralSwitches: [],
    presets: [],
    desired: { monitorSources: {}, peripheralOwners: {}, activePresetId: null },
    observed: { monitors: {}, peripherals: {} },
    commands: [],
    resolutions: {
      monitors: {
        'monitor:1': {
          status: options.status ?? 'in-sync',
          inFlightCommandId: null,
          error: null,
          desiredSourceComputerId: options.desiredId ?? null,
          observedSourceComputerId: options.observedId ?? null,
          lastKnownSourceComputerId: options.lastKnownId ?? options.observedId ?? null,
        },
      },
      peripherals: {},
    },
  };
}
