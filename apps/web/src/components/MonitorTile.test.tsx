import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot, testMonitor } from '../test/fixtures.js';
import { MonitorTile } from './MonitorTile.js';

describe('MonitorTile', () => {
  it('headlines the observed source and shows the request separately while switching', () => {
    render(
      <MonitorTile
        snapshot={makeSnapshot({
          status: 'switching',
          observedId: 'computer:pc',
          desiredId: 'computer:mac',
        })}
        monitor={testMonitor}
        onSelect={vi.fn()}
      />,
    );

    // The panel is still on the PC; the UI must not pretend otherwise.
    expect(screen.getByText('Gaming PC')).toBeDefined();
    expect(screen.getByText('→ M4 MacBook')).toBeDefined();
    expect(screen.getByText('Switching')).toBeDefined();
  });

  it('shows the custom name, the connector and no status chip once in sync', () => {
    render(
      <MonitorTile
        snapshot={makeSnapshot({
          status: 'in-sync',
          observedId: 'computer:mac',
          desiredId: 'computer:mac',
        })}
        monitor={testMonitor}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Top')).toBeDefined();
    expect(screen.getByText('HDMI')).toBeDefined();
    expect(screen.queryByText(/→/)).toBeNull();
    // A healthy tile carries no badge; only exceptions are called out.
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('shows the physical size and orientation from EDID', () => {
    render(
      <MonitorTile
        snapshot={makeSnapshot({ observedId: 'computer:pc' })}
        monitor={testMonitor}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('27" Landscape')).toBeDefined();
  });

  it('omits the size when the panel never reported one', () => {
    const monitor = {
      ...testMonitor,
      identity: { ...testMonitor.identity, physicalSizeInches: null },
    };
    render(
      <MonitorTile
        snapshot={makeSnapshot({ observedId: 'computer:pc', monitors: [monitor] })}
        monitor={monitor}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('Landscape')).toBeDefined();
  });

  it('shows the last seen source, marked stale, while the panel is unreadable', () => {
    render(
      <MonitorTile
        snapshot={makeSnapshot({
          status: 'unreachable',
          observedId: null,
          desiredId: 'computer:mac',
          lastKnownId: 'computer:pc',
        })}
        monitor={testMonitor}
        onSelect={vi.fn()}
      />,
    );

    const stale = screen.getByText('Gaming PC');
    expect(stale.className).toContain('is-stale');
    expect(screen.getByText('→ M4 MacBook')).toBeDefined();
    expect(screen.getByText('Unreachable')).toBeDefined();
  });

  it('renders an em dash rather than guessing when nothing has ever been observed', () => {
    render(
      <MonitorTile
        snapshot={makeSnapshot({ status: 'unknown', observedId: null, lastKnownId: null })}
        monitor={testMonitor}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('—')).toBeDefined();
  });

  it('describes itself for a screen reader without relying on colour', () => {
    render(
      <MonitorTile
        snapshot={makeSnapshot({ observedId: 'computer:pc' })}
        monitor={testMonitor}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Top, showing Gaming PC/ })).toBeDefined();
  });
});
