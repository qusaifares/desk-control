import type { DeskSnapshot, Monitor } from '@desk-control/domain';
import type React from 'react';
import { EmptyState } from '../design/index.js';
import { MonitorIcon } from './icons.js';
import { MonitorTile } from './MonitorTile.js';

interface Props {
  snapshot: DeskSnapshot;
  onSelectMonitor: (monitor: Monitor) => void;
}

/**
 * The physical desk map. Positions come entirely from the layout in config, so
 * a desk with two monitors or nine renders with no code change.
 */
export function DeskMap({ snapshot, onSelectMonitor }: Props) {
  const { columns, rows } = snapshot.layout.grid;
  const placed = snapshot.monitors.filter((monitor) => monitor.placement !== null);
  const autoPlaced = placed.filter((monitor) => monitor.placement?.autoPlaced);

  if (placed.length === 0) {
    return (
      <EmptyState icon={<MonitorIcon size={28} />}>
        No monitors discovered yet. Start an agent and they will appear here.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="desk-map" style={{ '--map-aspect': columns / rows } as React.CSSProperties}>
        {placed.map((monitor) => (
          <MonitorTile
            key={monitor.id}
            snapshot={snapshot}
            monitor={monitor}
            onSelect={onSelectMonitor}
          />
        ))}
      </div>
      {autoPlaced.length > 0 ? (
        <p className="desk-map-note">
          {autoPlaced.length} display{autoPlaced.length === 1 ? ' was' : 's were'} placed
          automatically — rearrange them in the desk config to match your desk.
        </p>
      ) : null}
    </>
  );
}
