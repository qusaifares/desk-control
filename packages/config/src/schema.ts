import {
  DeskLayoutSchema,
  PlatformSchema,
  DesiredStateSchema,
  PeripheralSchema,
  PeripheralSwitchSchema,
  PresetSchema,
} from '@desk-control/domain';
import { z } from 'zod';

/**
 * Persisted user configuration.
 *
 * This file holds *user intent and user labels only*. Hardware facts are never
 * persisted here - they are re-discovered from agents on every boot, so a
 * swapped monitor or a re-cabled desk cannot leave stale truth behind.
 */
export const CustomNamesSchema = z.object({
  computers: z.record(z.string(), z.string()).default({}),
  monitors: z.record(z.string(), z.string()).default({}),
  monitorInputs: z.record(z.string(), z.string()).default({}),
  peripherals: z.record(z.string(), z.string()).default({}),
});
export type CustomNames = z.infer<typeof CustomNamesSchema>;

export const DeskConfigSchema = z.object({
  /** Bumped when a migration is required; see migrate(). */
  configVersion: z.literal(1),
  controller: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  layout: DeskLayoutSchema,
  presets: z.array(PresetSchema).default([]),
  customNames: CustomNamesSchema.default({
    computers: {},
    monitors: {},
    monitorInputs: {},
    peripherals: {},
  }),
  peripherals: z.array(PeripheralSchema).default([]),
  peripheralSwitches: z.array(PeripheralSwitchSchema).default([]),
  /**
   * Manual wiring corrections: monitorId -> inputId -> computerId. Discovery
   * fills most of this in automatically; this is the user override lane for
   * inputs no agent can see (a console, a laptop with no agent installed).
   */
  wiringOverrides: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  /**
   * Computers the user declared by hand.
   *
   * A source does not need an agent to be useful: a games console, or a laptop
   * you have not installed anything on, is still a thing you route to a
   * monitor. The switch is carried out by whichever agent holds DDC access to
   * that monitor, so the declared machine never has to run anything.
   */
  manualComputers: z
    .array(
      z.object({
        id: z.string().min(1),
        detectedName: z.string().min(1),
        platform: PlatformSchema,
      }),
    )
    .default([]),
  /**
   * Last desired state, persisted for *display* after a restart.
   *
   * It is deliberately NOT re-applied automatically on boot: fail-passive means
   * a controller restart must not move the user's monitors underneath them.
   */
  lastDesiredState: DesiredStateSchema.optional(),
});
export type DeskConfig = z.infer<typeof DeskConfigSchema>;
