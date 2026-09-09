import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot, testMonitor } from '../test/fixtures.js';
import { MonitorEditorSheet } from './MonitorEditorSheet.js';

function renderSheet(overrides: Partial<Parameters<typeof MonitorEditorSheet>[0]> = {}) {
  const props = {
    snapshot: makeSnapshot({ observedId: 'computer:pc' }),
    monitor: testMonitor,
    onRename: vi.fn(),
    onSetWiring: vi.fn(),
    onDeclareComputer: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<MonitorEditorSheet {...props} />);
  return props;
}

describe('MonitorEditorSheet', () => {
  it('lists every input with what is currently plugged into it', () => {
    renderSheet();
    expect(screen.getByText('DisplayPort 1')).toBeDefined();
    expect(screen.getByText('HDMI 1')).toBeDefined();
    // Discovered wiring shows through.
    expect(screen.getByText('Gaming PC')).toBeDefined();
    expect(screen.getByText('M4 MacBook')).toBeDefined();
  });

  it('shows an unassigned input honestly rather than guessing', () => {
    const monitor = {
      ...testMonitor,
      inputs: testMonitor.inputs.map((input) =>
        input.id === 'input-0x11' ? { ...input, connectedComputerId: null } : input,
      ),
    };
    renderSheet({ monitor });
    expect(screen.getByText('Not assigned')).toBeDefined();
  });

  it('assigns a computer to an input', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('HDMI 1'));
    fireEvent.click(screen.getByText('Gaming PC'));
    expect(props.onSetWiring).toHaveBeenCalledWith('input-0x11', 'computer:pc');
  });

  it('clears an input back to unassigned', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('DisplayPort 1'));
    fireEvent.click(screen.getByText('Nothing'));
    expect(props.onSetWiring).toHaveBeenCalledWith('input-0x0f', null);
  });

  it('declares a machine that has no agent and wires it to the chosen input', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('HDMI 1'));
    fireEvent.click(screen.getByText('Add a machine…'));

    fireEvent.change(screen.getByPlaceholderText('PlayStation 5'), {
      target: { value: 'PlayStation 5' },
    });
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Other'));

    // The input it came from has to survive the whole flow.
    expect(props.onDeclareComputer).toHaveBeenCalledWith('PlayStation 5', 'unknown', 'input-0x11');
  });

  it('renames the monitor without touching its detected name', () => {
    const props = renderSheet();
    fireEvent.change(screen.getByPlaceholderText('ASUS XG27AQM'), {
      target: { value: 'Console Rail' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(props.onRename).toHaveBeenCalledWith('Console Rail');
  });

  it('offers to clear a custom name back to the detected one', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByText('Clear'));
    expect(props.onRename).toHaveBeenCalledWith(null);
    expect(screen.getByText(/falls back to/)).toBeDefined();
  });

  it('will not save an unchanged or empty name', () => {
    const props = renderSheet();
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('ASUS XG27AQM'), { target: { value: '   ' } });
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    expect(props.onRename).not.toHaveBeenCalled();
  });
});
