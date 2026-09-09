import type { DeskSnapshot, Monitor } from '@desk-control/domain';
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
  const unplaced = snapshot.monitors.filter((monitor) => monitor.placement === null);

  return (
    <section className="desk-map-section">
      <div className="desk-map" style={{ aspectRatio: `${columns} / ${rows}` }}>
        {placed.length === 0 ? (
          <p className="desk-map-empty">
            No monitors discovered yet. Start an agent and they will appear here.
          </p>
        ) : null}
        {placed.map((monitor) => (
          <MonitorTile
            key={monitor.id}
            snapshot={snapshot}
            monitor={monitor}
            onSelect={onSelectMonitor}
          />
        ))}
      </div>
      {unplaced.length > 0 ? (
        <p className="desk-map-note">
          {unplaced.length} discovered monitor(s) have no place on the desk layout yet:{' '}
          {unplaced.map((monitor) => monitor.detectedName).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
