import type { ReactNode } from 'react';

interface TileProps {
  icon?: ReactNode;
  label: string;
  /** Small marker in the corner, typically a StatusDot. */
  marker?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  hint?: string;
  onClick?: () => void;
}

/** A compact selectable target, sized for a finger. Used in grids. */
export function Tile({ icon, label, marker, selected, disabled, hint, onClick }: TileProps) {
  return (
    <button
      type="button"
      className={`ds-tile${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      disabled={disabled || !onClick}
      title={hint}
      aria-pressed={selected}
    >
      {icon ? <span className="ds-tile-icon">{icon}</span> : null}
      <span className="ds-tile-label">{label}</span>
      {marker ? <span className="ds-tile-marker">{marker}</span> : null}
    </button>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="ds-tile-grid">{children}</div>;
}
