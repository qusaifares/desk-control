import {
  ConnectorSchema,
  DisplayModeSchema,
  MonitorCapabilitySchema,
  PowerStateSchema,
  ReachabilitySchema,
} from '@desk-control/domain';
import { z } from 'zod';

/**
 * What an agent reports about hardware it can see.
 *
 * An agent reports *facts about itself and its cables*. It never reports desk
 * layout, custom names or presets - those are controller-side user data.
 */
export const MonitorInputReportSchema = z.object({
  id: z.string().min(1),
  connector: ConnectorSchema,
  ddcInputSourceValue: z.number().int().nonnegative().nullable().default(null),
  detectedName: z.string().min(1),
  maxMode: DisplayModeSchema.nullable().default(null),
});
export type MonitorInputReport = z.infer<typeof MonitorInputReportSchema>;

export const MonitorReportSchema = z.object({
  /**
   * Stable id computed by the agent from EDID. Agents on different machines
   * looking at the same panel must produce the same value - that is how the
   * controller merges control paths.
   */
  stableId: z.string().min(1),
  localHandle: z.string().min(1),
  detectedName: z.string().min(1),
  identity: z.object({
    manufacturerId: z.string(),
    model: z.string(),
    serial: z.string().nullable().default(null),
    manufactureYear: z.number().int().nullable().default(null),
    weakIdentity: z.boolean().default(false),
    physicalSizeInches: z.number().positive().nullable().default(null),
  }),
  capabilities: z.array(MonitorCapabilitySchema).default([]),
  inputs: z.array(MonitorInputReportSchema).default([]),
  /**
   * Which input this agent's own cable occupies. This is how the controller
   * learns the desk wiring without the user typing it in.
   */
  connectedViaInputId: z.string().nullable().default(null),
  /** Most monitors only answer DDC on the currently displayed input. */
  requiresActiveInput: z.boolean().default(true),
  preferredInputId: z.string().nullable().default(null),
});
export type MonitorReport = z.infer<typeof MonitorReportSchema>;

export const ObservedMonitorReportSchema = z.object({
  stableId: z.string().min(1),
  activeInputId: z.string().nullable().default(null),
  powerState: PowerStateSchema.default('unknown'),
  reachability: ReachabilitySchema.default('unknown'),
  error: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
});
export type ObservedMonitorReport = z.infer<typeof ObservedMonitorReportSchema>;
