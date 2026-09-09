import type { DeskSnapshot } from '@desk-control/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonitorTile } from './MonitorTile.js';

const monitor: DeskSnapshot['monitors'][number] = {
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
  },
  capabilities: ['input-switch'],
  inputs: [],
  controlPaths: [],
  preferredInputId: null,
  placement: { x: 0, y: 0, width: 10, height: 10, orientation: 'landscape' },
};

function snapshotWith(
  status: 'in-sync' | 'switching' | 'failed',
  observedId: string | null,
  desiredId: string | null,
): DeskSnapshot {
  return {
    revision: 1,
    updatedAt: new Date().toISOString(),
    controller: {
      id: 'controller:1',
      name: 'Desk',
      version: '0',
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
    monitors: [monitor],
    peripherals: [],
    peripheralSwitches: [],
    presets: [],
    desired: { monitorSources: {}, peripheralOwners: {}, activePresetId: null },
    observed: { monitors: {}, peripherals: {} },
    commands: [],
    resolutions: {
      monitors: {
        'monitor:1': {
          status,
          inFlightCommandId: null,
          error: null,
          desiredSourceComputerId: desiredId,
          observedSourceComputerId: observedId,
          lastKnownSourceComputerId: observedId,
        },
      },
      peripherals: {},
    },
  };
}

describe('MonitorTile', () => {
  it('headlines the observed source and shows the request separately while switching', () => {
    render(
      <MonitorTile
        snapshot={snapshotWith('switching', 'computer:pc', 'computer:mac')}
        monitor={monitor}
        onSelect={vi.fn()}
      />,
    );

    // The panel is still on the PC; the UI must not pretend otherwise.
    expect(screen.getByText('Gaming PC')).toBeDefined();
    expect(screen.getByText('→ M4 MacBook')).toBeDefined();
    expect(screen.getByText('Switching')).toBeDefined();
  });

  it('shows the custom name and no pending line once in sync', () => {
    render(
      <MonitorTile
        snapshot={snapshotWith('in-sync', 'computer:mac', 'computer:mac')}
        monitor={monitor}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Top')).toBeDefined();
    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('shows the last seen source, marked stale, while the panel is unreadable', () => {
    const snapshot = snapshotWith('switching', null, 'computer:mac');
    const resolution = snapshot.resolutions.monitors['monitor:1'];
    if (resolution) resolution.lastKnownSourceComputerId = 'computer:pc';

    render(<MonitorTile snapshot={snapshot} monitor={monitor} onSelect={vi.fn()} />);

    const stale = screen.getByText('Gaming PC');
    expect(stale.className).toContain('is-stale');
    expect(screen.getByText('→ M4 MacBook')).toBeDefined();
  });

  it('renders an em dash rather than guessing when nothing has been observed', () => {
    render(
      <MonitorTile
        snapshot={snapshotWith('failed', null, 'computer:mac')}
        monitor={monitor}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('—')).toBeDefined();
    expect(screen.getByText('Failed')).toBeDefined();
  });
});
