import type { DeskSnapshot, Monitor, Placement } from '@desk-control/domain';
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { EmptyState } from '../design/index.js';
import type { PlacementInput } from '../lib/api.js';
import { MonitorIcon } from './icons.js';
import { MonitorTile } from './MonitorTile.js';

interface Props {
  snapshot: DeskSnapshot;
  editing: boolean;
  onSelectMonitor: (monitor: Monitor) => void;
  onMoveMonitor: (monitorId: string, placement: PlacementInput) => void;
}

interface DragState {
  monitorId: string;
  pointerId: number;
  /** Where the pointer started, in grid units. */
  originX: number;
  originY: number;
  startPlacement: Placement;
  moved: boolean;
}

/** Snap to half a grid unit: fine enough to line monitors up, coarse enough to be usable with a finger. */
const SNAP = 0.5;
const snap = (value: number) => Math.round(value / SNAP) * SNAP;

/**
 * The physical desk map. Positions come entirely from the layout in config, so
 * a desk with two monitors or nine renders with no code change.
 *
 * In edit mode a monitor can be dragged. The in-flight position is local
 * component state - a gesture, not desk state - and is committed to the
 * controller on release; the next snapshot is what makes it real.
 */
export function DeskMap({ snapshot, editing, onSelectMonitor, onMoveMonitor }: Props) {
  const { columns, rows } = snapshot.layout.grid;
  const mapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{ id: string; placement: Placement } | null>(null);

  const toGrid = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = mapRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: ((event.clientX - rect.left) / rect.width) * columns,
        y: ((event.clientY - rect.top) / rect.height) * rows,
      };
    },
    [columns, rows],
  );

  const onPointerDown = useCallback(
    (monitor: Monitor) => (event: ReactPointerEvent) => {
      if (!editing || !monitor.placement) return;
      const point = toGrid(event);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setDrag({
        monitorId: monitor.id,
        pointerId: event.pointerId,
        originX: point.x,
        originY: point.y,
        startPlacement: monitor.placement,
        moved: false,
      });
    },
    [editing, toGrid],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const point = toGrid(event);
      const deltaX = point.x - drag.originX;
      const deltaY = point.y - drag.originY;
      if (!drag.moved && Math.abs(deltaX) < 0.25 && Math.abs(deltaY) < 0.25) return;

      setDrag({ ...drag, moved: true });
      setPreview({
        id: drag.monitorId,
        placement: {
          ...drag.startPlacement,
          x: Math.max(0, snap(drag.startPlacement.x + deltaX)),
          y: Math.max(0, snap(drag.startPlacement.y + deltaY)),
        },
      });
    },
    [drag, toGrid],
  );

  const endDrag = useCallback(() => {
    if (!drag) return;
    if (drag.moved && preview) {
      onMoveMonitor(drag.monitorId, {
        x: preview.placement.x,
        y: preview.placement.y,
        width: preview.placement.width,
        height: preview.placement.height,
        orientation: preview.placement.orientation,
      });
    }
    setDrag(null);
    // Keep the preview until the next snapshot lands so the tile does not
    // visibly snap back and forth across the round trip.
    if (!drag.moved) setPreview(null);
  }, [drag, onMoveMonitor, preview]);

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
      <div
        ref={mapRef}
        className={`desk-map${editing ? ' is-editing' : ''}`}
        style={{ '--map-aspect': columns / rows } as React.CSSProperties}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {placed.map((monitor) => (
          <MonitorTile
            key={monitor.id}
            snapshot={snapshot}
            monitor={monitor}
            editing={editing}
            placement={preview?.id === monitor.id ? preview.placement : null}
            onPointerDown={onPointerDown(monitor)}
            onSelect={() => {
              // A drag is not a tap.
              if (drag?.moved) return;
              onSelectMonitor(monitor);
            }}
          />
        ))}
      </div>
      {editing ? (
        <p className="desk-map-note">
          Drag a display to arrange it. Tap one to rename it or say what is plugged into each input.
        </p>
      ) : autoPlaced.length > 0 ? (
        <p className="desk-map-note">
          {autoPlaced.length} display{autoPlaced.length === 1 ? ' was' : 's were'} placed
          automatically — use <strong>Edit desk</strong> to arrange them.
        </p>
      ) : null}
    </>
  );
}
