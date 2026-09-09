import { z } from 'zod';
import { IdSchema } from './ids.js';
import { PlacementSchema } from './monitor.js';

/**
 * The desk layout is *user configuration*, kept separate from monitor identity.
 * Re-detecting hardware must never move the user's carefully arranged desk, and
 * moving a monitor in the UI must never rewrite hardware facts.
 */
export const DeskLayoutSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** Abstract grid the placements are expressed in. */
  grid: z.object({ columns: z.number().positive(), rows: z.number().positive() }),
  placements: z.record(IdSchema, PlacementSchema).default({}),
});
export type DeskLayout = z.infer<typeof DeskLayoutSchema>;

export function placementFor(layout: DeskLayout, monitorId: string) {
  return layout.placements[monitorId] ?? null;
}
