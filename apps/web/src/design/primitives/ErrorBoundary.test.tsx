import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.js';

function Boom(): never {
  throw new Error('render exploded');
}

beforeEach(() => {
  // React logs the caught error itself; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <p>the desk</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('the desk')).toBeDefined();
  });

  it('shows a fallback instead of a blank panel', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('render exploded')).toBeDefined();
  });

  it('says the desk itself is untouched, because it is', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // Fail-passive is the whole point: a crashed panel changes no hardware.
    expect(screen.getByText(/Your desk has not changed/)).toBeDefined();
  });

  it('offers a finger-sized way out, since the panel has no keyboard', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /reload the panel/i })).toBeDefined();
  });

  it('auto-reloads once when nobody is standing in front of it', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    vi.advanceTimersByTime(21_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not loop when the crash reproduces immediately', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });
    // As if a previous load already tried and crashed again.
    window.sessionStorage.setItem('desk-control:auto-reloaded', 'true');

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    vi.advanceTimersByTime(60_000);

    // Reloading forever would destroy the evidence and never recover.
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeDefined();
  });
});
