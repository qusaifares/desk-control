import type { DeskSnapshot, Monitor, Placement } from '@desk-control/domain';
import type React from 'react';
import { Chip, StatusDot } from '../design/index.js';
import {
  CONNECTOR_COLORS,
  describeMonitorFormat,
  screenStyle,
  STATUS_TONE,
} from '../lib/appearance.js';
import { computerById, displayNameOf, STATUS_LABELS } from '../lib/desk.js';
import { computerIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  monitor: Monitor;
  onSelect: (monitor: Monitor) => void;
  /** Overrides the stored placement while a drag is in progress. */
  placement?: Placement | null;
  editing?: boolean;
  onPointerDown?: (event: React.PointerEvent) => void;
}

/**
 * One monitor on the desk map.
 *
 * The tile always headlines OBSERVED state - what is actually on the panel. A
 * pending request appears as a separate "-> target" line and never overwrites
 * the headline, and while the panel is unreadable the last known source is
 * shown visibly marked as stale rather than blanking out.
 *
 * The coloured screen is an identity treatment for the source machine, not a
 * preview: this system never touches the video path.
 */
export function MonitorTile({
  snapshot,
  monitor,
  onSelect,
  placement: placementOverride,
  editing,
  onPointerDown,
}: Props) {
  const placement = placementOverride ?? monitor.placement;
  if (!placement) return null;

  const { columns, rows } = snapshot.layout.grid;
  const resolution = snapshot.resolutions.monitors[monitor.id];
  const status = resolution?.status ?? 'unknown';

  const observed = computerById(snapshot, resolution?.observedSourceComputerId ?? null);
  const desired = computerById(snapshot, resolution?.desiredSourceComputerId ?? null);
  const lastKnown = computerById(snapshot, resolution?.lastKnownSourceComputerId ?? null);
  const pending = desired && desired.id !== observed?.id;

  const shown = observed ?? lastKnown;
  const isStale = !observed && Boolean(lastKnown);

  const input = shown
    ? monitor.inputs.find((candidate) => candidate.connectedComputerId === shown.id)
    : undefined;

  return (
    <button
      type="button"
      className={`monitor${editing ? ' is-editing' : ''}`}
      data-status={status}
      onPointerDown={onPointerDown}
      style={{
        left: `${(placement.x / columns) * 100}%`,
        top: `${(placement.y / rows) * 100}%`,
        width: `${(placement.width / columns) * 100}%`,
        height: `${(placement.height / rows) * 100}%`,
      }}
      onClick={() => onSelect(monitor)}
      aria-label={`${displayNameOf(monitor)}, showing ${
        observed ? displayNameOf(observed) : 'no known source'
      }`}
    >
      <span className="monitor-frame">
        <span
          className="monitor-screen"
          style={screenStyle(shown, isStale || status !== 'in-sync')}
        >
          <span className="monitor-watermark">{shown ? computerIcon(shown, 24) : null}</span>
        </span>

        <span className="monitor-overlay">
          <span className="monitor-head">
            <span className="monitor-name">{displayNameOf(monitor)}</span>
            <span className="monitor-format">
              {describeMonitorFormat(monitor.identity.physicalSizeInches, placement.orientation)}
            </span>
          </span>

          <span className="monitor-foot">
            {shown ? (
              <span className={`monitor-source${isStale ? ' is-stale' : ''}`}>
                {displayNameOf(shown)}
              </span>
            ) : (
              <span className="monitor-source">—</span>
            )}

            {input ? (
              <span className="monitor-connector">
                <StatusDot color={CONNECTOR_COLORS[input.connector]} />
                {input.connector}
              </span>
            ) : null}

            {pending ? <span className="monitor-pending">→ {displayNameOf(desired)}</span> : null}
          </span>
        </span>

        {status === 'in-sync' ? null : (
          <span className="monitor-badge">
            <Chip tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Chip>
          </span>
        )}

        {resolution?.error ? (
          <span className="monitor-error">{resolution.error.message}</span>
        ) : null}
      </span>
    </button>
  );
}
