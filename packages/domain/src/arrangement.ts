import { z } from 'zod';
import type { Orientation } from './monitor.js';

/**
 * Where a computer's operating system has put a monitor on its desktop, in
 * physical pixels, as the user arranged it in the OS display settings.
 *
 * No monitor knows where it physically sits. This is the closest thing to a
 * reading of the real desk: people arrange their displays to match reality so
 * the pointer crosses at the right edge. It is still only a hint - the user's
 * own placement always wins.
 */
export const DesktopBoundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Clockwise rotation the OS applies. Width and height are already rotated. */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
});
export type DesktopBounds = z.infer<typeof DesktopBoundsSchema>;

export interface ArrangementEntry {
  monitorId: string;
  bounds: DesktopBounds;
  physicalSizeInches: number | null;
}

export interface ArrangedPlacement {
  monitorId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  orientation: Orientation;
}

/** A typical 27" 1440p panel, for monitors that do not report a size. */
const FALLBACK_INCHES_PER_PIXEL = 1 / 109;
/** Pixel slack when deciding two edges touch. */
const EDGE_TOLERANCE = 2;
/** Matches the desk map's drag snap. */
const SNAP = 0.5;
const snap = (value: number) => Math.round(value / SNAP) * SNAP;

interface Measured extends ArrangementEntry {
  /** Physical inches per pixel on this panel. */
  scale: number;
  width: number;
  height: number;
}

const right = (b: DesktopBounds) => b.x + b.width;
const bottom = (b: DesktopBounds) => b.y + b.height;
const near = (a: number, b: number) => Math.abs(a - b) <= EDGE_TOLERANCE;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

/**
 * Lays monitors out the way one computer's desktop has them, in inches.
 *
 * Desktop pixels cannot be used as positions directly: a 27" 4K panel is 3840
 * pixels wide and a 27" 1440p panel beside it is 2560, yet they are the same
 * physical width. So each panel is sized from its EDID diagonal, and positions
 * are rebuilt edge by edge: a panel touching another's edge on the desktop
 * touches it on the map, offset along that edge in the neighbour's own scale.
 */
export function arrangeFromDesktop(entries: readonly ArrangementEntry[]): ArrangedPlacement[] {
  if (entries.length === 0) return [];

  const knownScales: number[] = [];
  const scaleOf = (entry: ArrangementEntry): number | null => {
    if (!entry.physicalSizeInches) return null;
    const long = Math.max(entry.bounds.width, entry.bounds.height);
    const short = Math.min(entry.bounds.width, entry.bounds.height);
    const diagonalPixels = Math.hypot(long, short);
    return entry.physicalSizeInches / diagonalPixels;
  };
  for (const entry of entries) {
    const scale = scaleOf(entry);
    if (scale) knownScales.push(scale);
  }
  knownScales.sort((a, b) => a - b);
  const fallbackScale =
    knownScales.length > 0
      ? (knownScales[Math.floor(knownScales.length / 2)] ?? FALLBACK_INCHES_PER_PIXEL)
      : FALLBACK_INCHES_PER_PIXEL;

  const measured: Measured[] = [...entries]
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
    .map((entry) => {
      const scale = scaleOf(entry) ?? fallbackScale;
      return {
        ...entry,
        scale,
        width: entry.bounds.width * scale,
        height: entry.bounds.height * scale,
      };
    });

  const positions = new Map<string, { x: number; y: number }>();
  const first = measured[0]!;
  positions.set(first.monitorId, { x: 0, y: 0 });

  while (positions.size < measured.length) {
    // Place whichever panel shares the most edge with what is already placed,
    // so each one is pinned by as many neighbours as possible.
    let best: { entry: Measured; proposal: Proposal } | null = null;
    for (const candidate of measured) {
      if (positions.has(candidate.monitorId)) continue;
      const proposal = proposeFromNeighbours(candidate, measured, positions);
      if (proposal && (!best || proposal.sharedEdge > best.proposal.sharedEdge)) {
        best = { entry: candidate, proposal };
      }
    }
    if (best) {
      positions.set(best.entry.monitorId, { x: best.proposal.x, y: best.proposal.y });
      continue;
    }

    // Nothing touches what is placed so far (a gap in the desktop). Offset the
    // next one from the first panel rather than dropping it.
    const orphan = measured.find((entry) => !positions.has(entry.monitorId))!;
    positions.set(orphan.monitorId, {
      x: (orphan.bounds.x - first.bounds.x) * first.scale,
      y: (orphan.bounds.y - first.bounds.y) * first.scale,
    });
  }

  const minX = Math.min(...measured.map((entry) => positions.get(entry.monitorId)!.x));
  const minY = Math.min(...measured.map((entry) => positions.get(entry.monitorId)!.y));

  return measured.map((entry) => {
    const position = positions.get(entry.monitorId)!;
    // Snap edges, not sizes, so panels that touch keep touching after rounding.
    const left = snap(position.x - minX);
    const top = snap(position.y - minY);
    return {
      monitorId: entry.monitorId,
      x: left,
      y: top,
      width: Math.max(SNAP, snap(position.x - minX + entry.width) - left),
      height: Math.max(SNAP, snap(position.y - minY + entry.height) - top),
      orientation: orientationOf(entry.bounds),
    };
  });
}

interface Proposal {
  x: number;
  y: number;
  /** Pixels of edge shared with placed neighbours. */
  sharedEdge: number;
}

/**
 * Where a panel goes, judged from every placed neighbour it touches.
 *
 * With mixed pixel densities the offset along a shared edge depends on whose
 * scale measures it: a portrait beside a 4K and a 1440p panel comes out inches
 * apart measured against one or the other. Averaging, weighted by how much edge
 * each neighbour shares, lands where a person would put it.
 */
function proposeFromNeighbours(
  candidate: Measured,
  measured: readonly Measured[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
): Proposal | null {
  const c = candidate.bounds;
  let totalWeight = 0;
  let sumX = 0;
  let sumY = 0;

  for (const neighbour of measured) {
    const at = positions.get(neighbour.monitorId);
    if (!at) continue;
    const n = neighbour.bounds;
    const alongY = at.y + (c.y - n.y) * neighbour.scale;
    const alongX = at.x + (c.x - n.x) * neighbour.scale;

    let proposal: { x: number; y: number; weight: number } | null = null;
    if (overlaps(c.y, bottom(c), n.y, bottom(n))) {
      const weight = Math.min(bottom(c), bottom(n)) - Math.max(c.y, n.y);
      if (near(c.x, right(n))) proposal = { x: at.x + neighbour.width, y: alongY, weight };
      else if (near(right(c), n.x)) proposal = { x: at.x - candidate.width, y: alongY, weight };
    }
    if (!proposal && overlaps(c.x, right(c), n.x, right(n))) {
      const weight = Math.min(right(c), right(n)) - Math.max(c.x, n.x);
      if (near(c.y, bottom(n))) proposal = { x: alongX, y: at.y + neighbour.height, weight };
      else if (near(bottom(c), n.y)) proposal = { x: alongX, y: at.y - candidate.height, weight };
    }
    if (!proposal) continue;

    totalWeight += proposal.weight;
    sumX += proposal.x * proposal.weight;
    sumY += proposal.y * proposal.weight;
  }

  if (totalWeight === 0) return null;
  return { x: sumX / totalWeight, y: sumY / totalWeight, sharedEdge: totalWeight };
}

function orientationOf(bounds: DesktopBounds): Orientation {
  if (bounds.width >= bounds.height) return 'landscape';
  // Windows calls 90 "Portrait" and 270 "Portrait (flipped)".
  return bounds.rotation === 270 ? 'portrait-right' : 'portrait-left';
}
