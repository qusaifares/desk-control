import type { DeskSnapshot, Monitor } from '@desk-control/domain';
import { computerById, displayNameOf, STATUS_LABELS } from '../lib/desk.js';

interface Props {
  snapshot: DeskSnapshot;
  monitor: Monitor;
  onSelect: (monitor: Monitor) => void;
}

/**
 * One monitor on the desk map.
 *
 * The tile always shows OBSERVED state as the headline - what is actually on
 * the panel right now. A pending request appears as a separate "-> target"
 * line, never by overwriting the headline.
 */
export function MonitorTile({ snapshot, monitor, onSelect }: Props) {
  const placement = monitor.placement;
  if (!placement) return null;

  const { columns, rows } = snapshot.layout.grid;
  const resolution = snapshot.resolutions.monitors[monitor.id];
  const status = resolution?.status ?? 'unknown';
  const observed = computerById(snapshot, resolution?.observedSourceComputerId ?? null);
  const desired = computerById(snapshot, resolution?.desiredSourceComputerId ?? null);
  const pending = desired && desired.id !== observed?.id;
  // Mid-switch no agent can read the panel. Rather than blanking the tile we
  // show the last source we saw, visibly marked as stale.
  const lastKnown = computerById(snapshot, resolution?.lastKnownSourceComputerId ?? null);

  return (
    <button
      type="button"
      className={`monitor-tile status-${status}`}
      style={{
        left: `${(placement.x / columns) * 100}%`,
        top: `${(placement.y / rows) * 100}%`,
        width: `${(placement.width / columns) * 100}%`,
        height: `${(placement.height / rows) * 100}%`,
      }}
      onClick={() => onSelect(monitor)}
      aria-label={`${displayNameOf(monitor)}, showing ${observed ? displayNameOf(observed) : 'unknown source'}`}
    >
      <span className="monitor-name">{displayNameOf(monitor)}</span>
      {observed ? (
        <span className="monitor-source">{displayNameOf(observed)}</span>
      ) : lastKnown ? (
        <span
          className="monitor-source is-stale"
          title="Last seen; the panel cannot be read right now"
        >
          {displayNameOf(lastKnown)}
        </span>
      ) : (
        <span className="monitor-source">—</span>
      )}
      {pending ? <span className="monitor-pending">→ {displayNameOf(desired)}</span> : null}
      <span className={`chip chip-${status}`}>{STATUS_LABELS[status]}</span>
      {resolution?.error ? <span className="monitor-error">{resolution.error.message}</span> : null}
    </button>
  );
}
