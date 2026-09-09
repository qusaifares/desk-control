import { z } from 'zod';
import { IdSchema } from './ids.js';

/**
 * DESIRED vs OBSERVED
 * -------------------
 * Desired state is what the user asked for. Observed state is what agents
 * actually report. They are stored separately and never merged, because the
 * interesting cases live in the gap between them: switching, partial failure,
 * an unreachable monitor, or a user pressing the physical input button on the
 * monitor itself (drift).
 *
 * Nothing in this system may optimistically write an observation.
 */

export const StateOriginSchema = z.enum(['user', 'preset', 'restore', 'startup']);
export type StateOrigin = z.infer<typeof StateOriginSchema>;

export const DesiredMonitorSourceSchema = z.object({
  monitorId: IdSchema,
  sourceComputerId: IdSchema,
  requestedAt: z.string().datetime(),
  origin: StateOriginSchema,
  /** Command that carries this intent, when one has been issued. */
  commandId: IdSchema.nullable().default(null),
  presetId: IdSchema.nullable().default(null),
});
export type DesiredMonitorSource = z.infer<typeof DesiredMonitorSourceSchema>;

export const DesiredPeripheralOwnerSchema = z.object({
  peripheralId: IdSchema,
  ownerComputerId: IdSchema,
  requestedAt: z.string().datetime(),
  origin: StateOriginSchema,
  commandId: IdSchema.nullable().default(null),
  presetId: IdSchema.nullable().default(null),
});
export type DesiredPeripheralOwner = z.infer<typeof DesiredPeripheralOwnerSchema>;

export const DesiredStateSchema = z.object({
  monitorSources: z.record(IdSchema, DesiredMonitorSourceSchema).default({}),
  peripheralOwners: z.record(IdSchema, DesiredPeripheralOwnerSchema).default({}),
  activePresetId: IdSchema.nullable().default(null),
});
export type DesiredState = z.infer<typeof DesiredStateSchema>;

export const PowerStateSchema = z.enum(['on', 'standby', 'off', 'unknown']);
export type PowerState = z.infer<typeof PowerStateSchema>;

export const ReachabilitySchema = z.enum(['reachable', 'unreachable', 'unknown']);
export type Reachability = z.infer<typeof ReachabilitySchema>;

export const ObservationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ObservationError = z.infer<typeof ObservationErrorSchema>;

export const ObservedMonitorStateSchema = z.object({
  monitorId: IdSchema,
  activeInputId: IdSchema.nullable().default(null),
  /** Derived by the controller from activeInputId + wiring. */
  activeSourceComputerId: IdSchema.nullable().default(null),
  powerState: PowerStateSchema.default('unknown'),
  reachability: ReachabilitySchema.default('unknown'),
  observedAt: z.string().datetime(),
  /** Which agent reported this. Useful when several can see the monitor. */
  reportedByAgentId: IdSchema.nullable().default(null),
  lastError: ObservationErrorSchema.nullable().default(null),
});
export type ObservedMonitorState = z.infer<typeof ObservedMonitorStateSchema>;

export const ObservedPeripheralStateSchema = z.object({
  peripheralId: IdSchema,
  ownerComputerId: IdSchema.nullable().default(null),
  reachability: ReachabilitySchema.default('unknown'),
  observedAt: z.string().datetime(),
  lastError: ObservationErrorSchema.nullable().default(null),
});
export type ObservedPeripheralState = z.infer<typeof ObservedPeripheralStateSchema>;

export const ObservedStateSchema = z.object({
  monitors: z.record(IdSchema, ObservedMonitorStateSchema).default({}),
  peripherals: z.record(IdSchema, ObservedPeripheralStateSchema).default({}),
});
export type ObservedState = z.infer<typeof ObservedStateSchema>;

export const emptyDesiredState = (): DesiredState => ({
  monitorSources: {},
  peripheralOwners: {},
  activePresetId: null,
});

export const emptyObservedState = (): ObservedState => ({ monitors: {}, peripherals: {} });
