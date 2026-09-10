import type { DeskSnapshot, Preset } from '@desk-control/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '../test/fixtures.js';
import { PresetRail } from './PresetRail.js';

const preset: Preset = {
  id: 'preset:work',
  detectedName: 'Work',
  customName: null,
  description: 'MacBook stack',
  icon: 'briefcase',
  sortOrder: 0,
  assignments: { monitorSources: { 'monitor:1': 'computer:mac' }, peripheralOwners: {} },
};

function renderRail(editing: boolean, presets: Preset[] = [preset]) {
  const snapshot: DeskSnapshot = { ...makeSnapshot({ observedId: 'computer:pc' }), presets };
  const props = {
    snapshot,
    editing,
    onApply: vi.fn(),
    onEdit: vi.fn(),
    onCreate: vi.fn(),
  };
  render(<PresetRail {...props} />);
  return props;
}

describe('PresetRail', () => {
  it('applies a preset when not editing', () => {
    const props = renderRail(false);
    fireEvent.click(screen.getByText('Work'));
    expect(props.onApply).toHaveBeenCalledWith('preset:work');
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('edits a preset instead of applying it while editing', () => {
    const props = renderRail(true);
    fireEvent.click(screen.getByText('Work'));
    expect(props.onEdit).toHaveBeenCalledWith(preset);
    // Tapping a preset in Edit desk must not move the desk.
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('saves the current desk as a named preset', () => {
    const props = renderRail(true);
    fireEvent.click(screen.getByText('Save current desk…'));

    fireEvent.change(screen.getByPlaceholderText('Work'), { target: { value: 'Reading' } });
    fireEvent.click(screen.getByText('Save'));
    expect(props.onCreate).toHaveBeenCalledWith('Reading');
  });

  it('points at Edit desk when there are no presets yet', () => {
    renderRail(false, []);
    expect(screen.getByText('Use Edit desk to save one')).toBeDefined();
  });

  it('shows the Custom indicator only when not editing', () => {
    renderRail(false, []);
    expect(screen.getByText('Custom')).toBeDefined();

    renderRail(true, []);
    // In edit mode the slot is the save action instead.
    expect(screen.getAllByText('Custom')).toHaveLength(1);
    expect(screen.getByText('Save current desk…')).toBeDefined();
  });
});
