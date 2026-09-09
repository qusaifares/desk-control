import { z } from 'zod';
import { MonitorCapabilitySchema } from './capability.js';
import { IdSchema } from './ids.js';
import { NameableSchema } from './naming.js';

export const ConnectorSchema = z.enum([
  'DisplayPort',
  'mini-DisplayPort',
  'HDMI',
  'USB-C',
  'Thunderbolt',
  'DVI',
  'VGA',
  'unknown',
]);
export type Connector = z.infer<typeof ConnectorSchema>;

/**
 * Performance model. Deliberately descriptive, not prescriptive: this bootstrap
 * records what a path *can* do so a future planner can warn when a requested
 * route downgrades the user (e.g. 240Hz DP -> 60Hz HDMI). No validation logic
 * consumes this yet.
 */
export const DisplayModeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  refreshHz: z.number().positive(),
  vrr: z.boolean().default(false),
  bitDepth: z.number().int().positive().optional(),
});
export type DisplayMode = z.infer<typeof DisplayModeSchema>;

/**
 * A physical connector on the monitor.
 *
 * `ddcInputSourceValue` is the VCP 0x60 value used to select this input. It is
 * vendor-specific and therefore lives with the input, never in core logic.
 *
 * `connectedComputerId` is a *wiring* fact: which machine's cable is plugged in.
 * It may be discovered (an agent that can talk DDC over this input knows it is
 * on this input) or configured by the user.
 */
export const MonitorInputSchema = NameableSchema.extend({
  id: IdSchema,
  connector: ConnectorSchema,
  ddcInputSourceValue: z.number().int().nonnegative().nullable().default(null),
  connectedComputerId: IdSchema.nullable().default(null),
  /** Best mode this input is known to support with the attached source. */
  maxMode: DisplayModeSchema.nullable().default(null),
});
export type MonitorInput = z.infer<typeof MonitorInputSchema>;

export const OrientationSchema = z.enum(['landscape', 'portrait-left', 'portrait-right']);
export type Orientation = z.infer<typeof OrientationSchema>;

/**
 * Placement on the desk, in abstract grid units (not pixels, not millimetres).
 * The UI scales these; the controller never interprets them.
 */
export const PlacementSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  orientation: OrientationSchema.default('landscape'),
  /**
   * True when the controller placed this monitor itself because the user had
   * not arranged it yet. The UI can invite the user to move it; nothing else
   * treats it differently.
   */
  autoPlaced: z.boolean().default(false),
});
export type Placement = z.infer<typeof PlacementSchema>;

/**
 * How the controller can reach a monitor to issue DDC commands.
 *
 * One physical monitor usually has several control paths - one per computer
 * wired into it. They are merged under the monitor's stable id.
 *
 * `requiresActiveInput` captures the real DDC/CI constraint: most monitors only
 * answer DDC on the input that is currently displayed, so the agent whose cable
 * is *currently selected* is the only one that can reliably drive the switch.
 */
export const MonitorControlPathSchema = z.object({
  agentId: IdSchema,
  computerId: IdSchema,
  /** Handle meaningful only to that agent's provider (WMI id, i2c bus, ...). */
  localHandle: z.string(),
  /** Which monitor input this agent's cable occupies, when known. */
  inputId: IdSchema.nullable().default(null),
  capabilities: z.array(MonitorCapabilitySchema).default([]),
  requiresActiveInput: z.boolean().default(true),
});
export type MonitorControlPath = z.infer<typeof MonitorControlPathSchema>;

export const MonitorIdentitySchema = z.object({
  /** EDID manufacturer id, e.g. "AUS". */
  manufacturerId: z.string(),
  model: z.string(),
  serial: z.string().nullable().default(null),
  manufactureYear: z.number().int().nullable().default(null),
  /** True when identity had to fall back to a port-based disambiguator. */
  weakIdentity: z.boolean().default(false),
});
export type MonitorIdentity = z.infer<typeof MonitorIdentitySchema>;

export const MonitorSchema = NameableSchema.extend({
  id: IdSchema,
  kind: z.literal('monitor').default('monitor'),
  identity: MonitorIdentitySchema,
  capabilities: z.array(MonitorCapabilitySchema).default([]),
  inputs: z.array(MonitorInputSchema).default([]),
  controlPaths: z.array(MonitorControlPathSchema).default([]),
  preferredInputId: IdSchema.nullable().default(null),
  /** Resolved from the DeskLayout; null when the user has not placed it yet. */
  placement: PlacementSchema.nullable().default(null),
});
export type Monitor = z.infer<typeof MonitorSchema>;

export function findInputForComputer(
  monitor: Monitor,
  computerId: string,
): MonitorInput | undefined {
  return monitor.inputs.find((input) => input.connectedComputerId === computerId);
}

export function findInput(monitor: Monitor, inputId: string): MonitorInput | undefined {
  return monitor.inputs.find((input) => input.id === inputId);
}

/**
 * Chooses which agent should carry out a DDC command for this monitor.
 *
 * Preference order:
 *   1. an online path whose input is the one currently displayed
 *      (satisfies `requiresActiveInput` monitors),
 *   2. any online path that does not require the active input,
 *   3. nothing - the caller must report the monitor as unreachable rather than
 *      pretending the switch happened.
 */
export function selectControlPath(
  monitor: Monitor,
  options: { activeInputId: string | null; isAgentOnline: (agentId: string) => boolean },
): MonitorControlPath | undefined {
  const online = monitor.controlPaths.filter((path) => options.isAgentOnline(path.agentId));
  const onActiveInput = online.find(
    (path) => options.activeInputId !== null && path.inputId === options.activeInputId,
  );
  if (onActiveInput) return onActiveInput;
  return online.find((path) => !path.requiresActiveInput);
}
