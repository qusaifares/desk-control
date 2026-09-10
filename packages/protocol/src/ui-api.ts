import { DeskSnapshotSchema } from '@desk-control/domain';
import { z } from 'zod';

/**
 * The client-facing API. Kept in the protocol package (not inside the web app)
 * because more than one client will speak it: the Pi touchscreen, a browser, a
 * phone, and eventually integration tests and CLI tooling.
 *
 * Mutations are HTTP POSTs; state arrives as a WebSocket push of the whole
 * snapshot. Full snapshots are a deliberate simplification - the desk is tiny
 * (tens of entities) and it removes a whole class of client/server drift bugs.
 */
export const SetMonitorSourceRequestSchema = z.object({
  monitorId: z.string().min(1),
  sourceComputerId: z.string().min(1),
  /** Client-supplied idempotency key; the server generates one if omitted. */
  commandId: z.string().min(1).optional(),
});
export type SetMonitorSourceRequest = z.infer<typeof SetMonitorSourceRequestSchema>;

export const SetPeripheralOwnerRequestSchema = z.object({
  peripheralId: z.string().min(1),
  ownerComputerId: z.string().min(1),
  commandId: z.string().min(1).optional(),
});
export type SetPeripheralOwnerRequest = z.infer<typeof SetPeripheralOwnerRequestSchema>;

export const SetMonitorBrightnessRequestSchema = z.object({
  monitorId: z.string().min(1),
  brightness: z.number().int().min(0).max(100),
  commandId: z.string().min(1).optional(),
});
export type SetMonitorBrightnessRequest = z.infer<typeof SetMonitorBrightnessRequestSchema>;

export const SetMonitorPowerRequestSchema = z.object({
  /** Omit to apply to every monitor that supports power control. */
  monitorId: z.string().min(1).optional(),
  powerState: z.enum(['on', 'standby', 'off']),
});
export type SetMonitorPowerRequest = z.infer<typeof SetMonitorPowerRequestSchema>;

export const ApplyPresetRequestSchema = z.object({
  presetId: z.string().min(1),
});
export type ApplyPresetRequest = z.infer<typeof ApplyPresetRequestSchema>;

const PresetAssignmentInputSchema = z.object({
  monitorSources: z.record(z.string(), z.string()).default({}),
  peripheralOwners: z.record(z.string(), z.string()).default({}),
});

export const CreatePresetRequestSchema = z.object({
  detectedName: z.string().min(1).max(60),
  description: z.string().max(200).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  /** Omit to capture whatever the desk is showing right now. */
  assignments: PresetAssignmentInputSchema.optional(),
});
export type CreatePresetRequest = z.infer<typeof CreatePresetRequestSchema>;

export const UpdatePresetRequestSchema = z.object({
  presetId: z.string().min(1),
  description: z.string().max(200).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  assignments: PresetAssignmentInputSchema.optional(),
  /** Replace the preset's assignments with the desk as it is right now. */
  captureCurrent: z.boolean().optional(),
});
export type UpdatePresetRequest = z.infer<typeof UpdatePresetRequestSchema>;

export const DeletePresetRequestSchema = z.object({ presetId: z.string().min(1) });
export type DeletePresetRequest = z.infer<typeof DeletePresetRequestSchema>;

/**
 * Presentation overrides for any entity, keyed by its stable id.
 *
 * The entity type is implied by the id rather than passed in - ids are already
 * namespaced. Omitted fields are left untouched; a field sent as null is
 * cleared, which is how a custom name falls back to the detected one.
 */
export const SetOverrideRequestSchema = z.object({
  entityId: z.string().min(1),
  customName: z.string().min(1).max(120).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  colorway: z.string().max(40).nullable().optional(),
});
export type SetOverrideRequest = z.infer<typeof SetOverrideRequestSchema>;

export const SetPlacementRequestSchema = z.object({
  monitorId: z.string().min(1),
  placement: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    orientation: z.enum(['landscape', 'portrait-left', 'portrait-right']),
  }),
});
export type SetPlacementRequest = z.infer<typeof SetPlacementRequestSchema>;

/** Declares what is plugged into a monitor input. null clears the override. */
export const SetWiringRequestSchema = z.object({
  monitorId: z.string().min(1),
  inputId: z.string().min(1),
  computerId: z.string().min(1).nullable(),
});
export type SetWiringRequest = z.infer<typeof SetWiringRequestSchema>;

/** Adds a source that has no agent and never will - a console, say. */
export const DeclareComputerRequestSchema = z.object({
  detectedName: z.string().min(1).max(60),
  platform: z.enum(['windows', 'macos', 'linux', 'unknown']),
});
export type DeclareComputerRequest = z.infer<typeof DeclareComputerRequestSchema>;

export const CommandAcceptedResponseSchema = z.object({
  accepted: z.boolean(),
  commandIds: z.array(z.string()),
  /** Targets that could not be actioned, with a machine-readable reason. */
  skipped: z.array(z.object({ targetId: z.string(), reason: z.string() })).default([]),
});
export type CommandAcceptedResponse = z.infer<typeof CommandAcceptedResponseSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** WebSocket frames pushed to UI clients. */
export const UiServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), snapshot: DeskSnapshotSchema }),
  z.object({ type: z.literal('pong'), sentAt: z.string() }),
]);
export type UiServerMessage = z.infer<typeof UiServerMessageSchema>;
