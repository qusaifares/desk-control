import { z } from 'zod';
import { DeskCommandSchema } from './command.js';
import { AgentSchema, ComputerSchema, ControllerInfoSchema } from './device.js';
import { DeskLayoutSchema } from './layout.js';
import { MonitorSchema } from './monitor.js';
import { PeripheralSchema, PeripheralSwitchSchema } from './peripheral.js';
import { PresetSchema } from './preset.js';
import { SyncStatusSchema } from './reconcile.js';
import { DesiredStateSchema, ObservedStateSchema } from './state.js';

const ResolutionSchema = z.object({
  status: SyncStatusSchema,
  inFlightCommandId: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

/**
 * The single payload the controller pushes to every UI client.
 *
 * Resolutions are computed on the controller so that a phone, a browser and the
 * Pi touchscreen can never disagree about what "switching" means. UI clients
 * render this; they do not derive it.
 */
export const DeskSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  controller: ControllerInfoSchema,
  layout: DeskLayoutSchema,
  computers: z.array(ComputerSchema),
  agents: z.array(AgentSchema),
  monitors: z.array(MonitorSchema),
  peripherals: z.array(PeripheralSchema),
  peripheralSwitches: z.array(PeripheralSwitchSchema),
  presets: z.array(PresetSchema),
  desired: DesiredStateSchema,
  observed: ObservedStateSchema,
  /** Commands that are in flight or recently terminal, newest first. */
  commands: z.array(DeskCommandSchema),
  resolutions: z.object({
    monitors: z.record(
      z.string(),
      ResolutionSchema.extend({
        desiredSourceComputerId: z.string().nullable(),
        observedSourceComputerId: z.string().nullable(),
        /**
         * Last source we ever observed on this panel. Shown dimmed while a
         * switch is in progress so the tile does not blank out - it is history,
         * never presented as current truth.
         */
        lastKnownSourceComputerId: z.string().nullable(),
      }),
    ),
    peripherals: z.record(
      z.string(),
      ResolutionSchema.extend({
        desiredOwnerComputerId: z.string().nullable(),
        observedOwnerComputerId: z.string().nullable(),
      }),
    ),
  }),
});
export type DeskSnapshot = z.infer<typeof DeskSnapshotSchema>;
