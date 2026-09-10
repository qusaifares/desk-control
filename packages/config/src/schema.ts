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
/**
 * User overrides layered over a discovered entity, keyed by its stable id.
 *
 * One record per entity rather than a parallel map per field: adding a field
 * used to mean adding a whole top-level structure and threading it through the
 * schema, the store, the snapshot and the API. Now it is one property.
 *
 * Scope is deliberately narrow - this is *presentation only*. Being wrong here
 * costs a wrong label; it can never send a command to the wrong input. Facts
 * the user asserts about hardware (`wiringOverrides`) and spatial configuration
 * (`layout.placements`) stay separate, because they drive behaviour and are
 * shaped differently.
 */
export const EntityOverrideSchema = z.object({
  customName: z.string().min(1).max(120).nullable().default(null),
  /** Icon hint, e.g. "gamepad". Free-form; the UI falls back if unknown. */
  icon: z.string().max(40).nullable().default(null),
  /** Named colourway, e.g. "ember". Never a raw colour value. */
  colorway: z.string().max(40).nullable().default(null),
});
export type EntityOverride = z.infer<typeof EntityOverrideSchema>;

export const emptyOverride = (): EntityOverride => ({
  customName: null,
  icon: null,
  colorway: null,
});

export const DeskConfigSchema = z.object({
  /** Bumped when the shape changes; see migrateDeskConfig(). */
  configVersion: z.literal(2),
  controller: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  layout: DeskLayoutSchema,
  presets: z.array(PresetSchema).default([]),
  /**
   * entityId -> override. Monitor inputs use `<monitorId>:<inputId>`; every
   * other id is already namespaced and unambiguous on its own.
   */
  overrides: z.record(z.string(), EntityOverrideSchema).default({}),
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
