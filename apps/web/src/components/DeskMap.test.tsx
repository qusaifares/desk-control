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
