import type { Tone } from './types.js';

interface StatusDotProps {
  tone?: Tone;
  /** Escape hatch for meaning that is not a tone, such as a connector colour. */
  color?: string;
  pulsing?: boolean;
  label?: string;
}

export function StatusDot({ tone = 'idle', color, pulsing, label }: StatusDotProps) {
  return (
    <span
      className={`ds-dot${pulsing ? ' is-pulsing' : ''}`}
      data-tone={color ? undefined : tone}
      style={color ? { background: color } : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}
