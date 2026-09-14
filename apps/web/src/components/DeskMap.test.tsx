import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '../test/fixtures.js';
import { DeskMap } from './DeskMap.js';

function renderMap() {
  const props = {
    snapshot: makeSnapshot({ observedId: 'computer:pc' }),
    editing: true,
    onSelectMonitor: vi.fn(),
    onMoveMonitor: vi.fn(),
    onResetLayout: vi.fn(),
  };
  render(<DeskMap {...props} />);
  return props;
}

describe('DeskMap auto-arrange', () => {
  it('asks for a second tap before throwing the layout away', () => {
    const props = renderMap();

    fireEvent.click(screen.getByText('Auto-arrange'));
    expect(props.onResetLayout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Replace my layout'));
    expect(props.onResetLayout).toHaveBeenCalledTimes(1);
  });
});

describe('DeskMap dragging', () => {
  it('does not open a monitor when the gesture was a drag', () => {
    const props = renderMap();
    const tile = screen.getAllByRole('button').find((button) => button.closest('.desk-map'))!;
    const map = tile.closest('.desk-map') as HTMLElement;
    map.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 }) as DOMRect;
    tile.setPointerCapture = () => {};

    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 1, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 300, clientY: 200 });
    // The browser follows pointerup with a click on the tile.
    fireEvent.click(tile);

    expect(props.onMoveMonitor).toHaveBeenCalledTimes(1);
    expect(props.onSelectMonitor).not.toHaveBeenCalled();
  });

  it('still opens a monitor on a plain tap', () => {
    const props = renderMap();
    const tile = screen.getAllByRole('button').find((button) => button.closest('.desk-map'))!;
    tile.setPointerCapture = () => {};

    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(tile.closest('.desk-map')!, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.click(tile);

    expect(props.onSelectMonitor).toHaveBeenCalledTimes(1);
  });
});
