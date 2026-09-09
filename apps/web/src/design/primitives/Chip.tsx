import type { ReactNode } from 'react';
import type { Tone } from './types.js';

/** A small status pill. Takes a tone, never a colour. */
export function Chip({ tone = 'idle', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="ds-chip" data-tone={tone}>
      {children}
    </span>
  );
}
