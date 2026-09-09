import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot, testMonitor } from '../test/fixtures.js';
import { SourcePicker } from './SourcePicker.js';

function renderPicker(overrides: Partial<Parameters<typeof SourcePicker>[0]> = {}) {
  const snapshot = makeSnapshot({ observedId: 'computer:pc' });
  snapshot.observed.monitors[testMonitor.id] = {
    monitorId: testMonitor.id,
    activeInputId: 'input-0x0f',
    activeSourceComputerId: 'computer:pc',
    powerState: 'on',
    brightness: 42,
    reachability: 'reachable',
    observedAt: new Date().toISOString(),
    reportedByAgentId: 'agent:pc',
    lastError: null,
  };

  const props = {
    snapshot,
    monitor: { ...testMonitor, capabilities: ['input-switch', 'brightness', 'power'] as const },
    onPick: vi.fn(),
    onSetBrightness: vi.fn(),
    onSetPower: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SourcePicker {...(props as Parameters<typeof SourcePicker>[0])} />);
  return props;
}

describe('SourcePicker', () => {
  it('shows the brightness the panel reported, not what was last requested', () => {
    renderPicker();
    expect(screen.getByText('42%')).toBeDefined();
  });

  it('commits a brightness change on release, not on every step of travel', () => {
    const props = renderPicker();
    const slider = screen.getByRole('slider');

    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.change(slider, { target: { value: '35' } });
    // Each commit is a real DDC write; dragging must not fire one per pixel.
    expect(props.onSetBrightness).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    expect(props.onSetBrightness).toHaveBeenCalledTimes(1);
    expect(props.onSetBrightness).toHaveBeenCalledWith(35);
  });

  it('offers power control only when the panel advertises it', () => {
    renderPicker();
    expect(screen.getByText('Turn this display off')).toBeDefined();

    const noPower = { ...testMonitor, capabilities: ['input-switch'] as const };
    renderPicker({ monitor: noPower as unknown as typeof testMonitor });
    expect(screen.queryAllByText('Turn this display off')).toHaveLength(1);
  });

  it('hides the brightness control on a panel that cannot do it', () => {
    renderPicker({
      monitor: { ...testMonitor, capabilities: ['input-switch'] } as typeof testMonitor,
    });
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('says so when brightness has never been read', () => {
    const snapshot = makeSnapshot({ observedId: 'computer:pc' });
    renderPicker({ snapshot });
    expect(screen.getByText('not read yet')).toBeDefined();
  });
});
