import type { DeskSnapshot } from '@desk-control/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '../test/fixtures.js';
import { SystemSheet } from './SystemSheet.js';

function withAgent(snapshot: DeskSnapshot, providerKind: string): DeskSnapshot {
  return {
    ...snapshot,
    agents: [
      {
        id: 'agent:pc',
        computerId: 'computer:pc',
        detectedName: 'pc agent',
        customName: null,
        platform: 'windows',
        protocolVersion: 1,
        agentVersion: '0.1.0',
        providerKind,
        supportedCommandKinds: ['set-monitor-input'],
        connectivity: { state: 'online', lastSeenAt: null },
      },
    ],
  };
}

function renderSheet(snapshot: DeskSnapshot = makeSnapshot({ observedId: 'computer:pc' })) {
  const props = {
    snapshot,
    onRenameComputer: vi.fn(),
    onSetAppearance: vi.fn(),
    onClose: vi.fn(),
  };
  render(<SystemSheet {...props} />);
  return props;
}

describe('SystemSheet', () => {
  it('lists every computer, including ones with no agent', () => {
    renderSheet();
    expect(screen.getByText('Gaming PC')).toBeDefined();
    expect(screen.getByText('M4 MacBook')).toBeDefined();
    expect(screen.getAllByText('No agent has ever registered')).toHaveLength(2);
  });

  it('renames a computer without touching what its agent reported', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('Gaming PC'));

    // The detected name is offered as the placeholder, not overwritten.
    const input = screen.getByPlaceholderText('DESKTOP');
    fireEvent.change(input, { target: { value: 'Battlestation' } });
    fireEvent.click(screen.getByText('Save'));

    expect(props.onRenameComputer).toHaveBeenCalledWith('computer:pc', 'Battlestation');
  });

  it('clears a custom name back to what the agent reports', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('Gaming PC'));
    fireEvent.click(screen.getByText('Clear'));
    expect(props.onRenameComputer).toHaveBeenCalledWith('computer:pc', null);
  });

  it('shows the machine identity so a rename cannot be mistaken for it', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Gaming PC'));
    expect(screen.getByText('computer:pc')).toBeDefined();
    expect(screen.getByText(/reported by its agent as/i)).toBeDefined();
  });

  it('sets a colourway, and clears it by tapping the same swatch again', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('Gaming PC'));

    fireEvent.click(screen.getByLabelText('Ember'));
    expect(props.onSetAppearance).toHaveBeenCalledWith('computer:pc', { colorway: 'ember' });
  });

  it('sets an icon independently of the name', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('Gaming PC'));

    fireEvent.click(screen.getByLabelText('gamepad'));
    expect(props.onSetAppearance).toHaveBeenCalledWith('computer:pc', { icon: 'gamepad' });
    // Appearance and naming are separate overrides; one must not imply the other.
    expect(props.onRenameComputer).not.toHaveBeenCalled();
  });

  it('marks a simulated agent so mock hardware cannot pass for real', () => {
    renderSheet(withAgent(makeSnapshot({ observedId: 'computer:pc' }), 'mock'));
    expect(screen.getByText('Simulated')).toBeDefined();
  });

  it('does not mark a real agent as simulated', () => {
    renderSheet(withAgent(makeSnapshot({ observedId: 'computer:pc' }), 'windows-ddc'));
    expect(screen.queryByText('Simulated')).toBeNull();
    expect(screen.getByText(/windows-ddc/)).toBeDefined();
  });
});
