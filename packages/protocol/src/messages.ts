import {
  CommandPayloadSchema,
  ComputerCapabilitySchema,
  ControllerInfoSchema,
  PlatformSchema,
} from '@desk-control/domain';
import { z } from 'zod';
import { ProtocolErrorSchema } from './errors.js';
import { MonitorReportSchema, ObservedMonitorReportSchema } from './reports.js';
import { PROTOCOL_VERSION } from './version.js';

/**
 * Every frame on the wire carries the protocol version and its own id, so a
 * peer can log, correlate and reject without understanding the payload.
 */
const envelopeFields = {
  v: z.number().int().positive(),
  messageId: z.string().min(1),
  sentAt: z.string().datetime(),
};

function message<TType extends string, TPayload extends z.ZodTypeAny>(
  type: TType,
  payload: TPayload,
) {
  return z.object({ ...envelopeFields, type: z.literal(type), payload });
}

/* ------------------------------------------------------------------ *
 * Agent -> Controller
 * ------------------------------------------------------------------ */

export const AgentHelloPayloadSchema = z.object({
  agent: z.object({
    id: z.string().min(1),
    detectedName: z.string().min(1),
    agentVersion: z.string(),
    providerKind: z.string(),
  }),
  computer: z.object({
    id: z.string().min(1),
    detectedName: z.string().min(1),
    platform: PlatformSchema,
    capabilities: z.array(ComputerCapabilitySchema).default([]),
    metadata: z.record(z.string()).default({}),
  }),
  monitors: z.array(MonitorReportSchema).default([]),
  /**
   * Command kinds this agent can carry out.
   *
   * Optional, and defaulted to the original set, so an agent built before a
   * command kind existed is described accurately rather than being sent work it
   * would reject. This is why adding a command kind needs no protocol bump: the
   * controller simply does not dispatch it to agents that never claimed it.
   */
  supportedCommandKinds: z.array(z.string()).default(['set-monitor-input']),
  /**
   * Optional shared secret. Absent today for a fresh LAN install; the field
   * exists now so authentication can be turned on without a version bump.
   */
  authToken: z.string().nullable().default(null),
});

export const AgentHelloSchema = message('agent.hello', AgentHelloPayloadSchema);

export const AgentHeartbeatSchema = message(
  'agent.heartbeat',
  z.object({ uptimeSeconds: z.number().nonnegative() }),
);

export const AgentInventorySchema = message(
  'agent.inventory',
  z.object({ monitors: z.array(MonitorReportSchema) }),
);

export const AgentObservedStateSchema = message(
  'agent.observed-state',
  z.object({
    monitors: z.array(ObservedMonitorReportSchema),
    /**
     * USB devices this machine currently enumerates, as `vendor:product`.
     *
     * Optional, so an agent that cannot enumerate USB simply omits it rather
     * than claiming an empty desk. This is how peripheral ownership becomes
     * observable at all when the switch itself reports nothing.
     */
    usbDevices: z.array(z.string()).optional(),
  }),
);

export const AgentCommandAckSchema = message(
  'agent.command-ack',
  z.object({ commandId: z.string().min(1) }),
);

export const AgentCommandResultSchema = message(
  'agent.command-result',
  z.object({
    commandId: z.string().min(1),
    ok: z.boolean(),
    error: ProtocolErrorSchema.nullable().default(null),
    /** Fresh observation captured right after the command finished. */
    observed: z.array(ObservedMonitorReportSchema).default([]),
  }),
);

export const AgentErrorSchema = message('agent.error', ProtocolErrorSchema);

export const AgentToControllerMessageSchema = z.discriminatedUnion('type', [
  AgentHelloSchema,
  AgentHeartbeatSchema,
  AgentInventorySchema,
  AgentObservedStateSchema,
  AgentCommandAckSchema,
  AgentCommandResultSchema,
  AgentErrorSchema,
]);
export type AgentToControllerMessage = z.infer<typeof AgentToControllerMessageSchema>;

/* ------------------------------------------------------------------ *
 * Controller -> Agent
 * ------------------------------------------------------------------ */

export const ControllerWelcomeSchema = message(
  'controller.welcome',
  z.object({
    controller: ControllerInfoSchema,
    sessionId: z.string().min(1),
    heartbeatIntervalMs: z.number().int().positive(),
    /** Agents should give up on their own work after this long. */
    commandTimeoutMs: z.number().int().positive(),
    observeIntervalMs: z.number().int().positive(),
  }),
);

export const ControllerRejectSchema = message('controller.reject', ProtocolErrorSchema);

export const ControllerPingSchema = message('controller.ping', z.object({}));

export const ControllerCommandSchema = message(
  'controller.command',
  z.object({
    /** Idempotency key: replaying this id must not act twice. */
    commandId: z.string().min(1),
    payload: CommandPayloadSchema,
    deadlineAt: z.string().datetime(),
  }),
);

export const ControllerRefreshInventorySchema = message(
  'controller.refresh-inventory',
  z.object({}),
);

export const ControllerToAgentMessageSchema = z.discriminatedUnion('type', [
  ControllerWelcomeSchema,
  ControllerRejectSchema,
  ControllerPingSchema,
  ControllerCommandSchema,
  ControllerRefreshInventorySchema,
]);
export type ControllerToAgentMessage = z.infer<typeof ControllerToAgentMessageSchema>;

/* ------------------------------------------------------------------ */

let counter = 0;

/** Builds a well-formed envelope. Ids are only required to be unique per peer. */
export function buildMessage<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
): { v: number; messageId: string; sentAt: string; type: TType; payload: TPayload } {
  counter += 1;
  return {
    v: PROTOCOL_VERSION,
    messageId: `${Date.now().toString(36)}-${counter.toString(36)}`,
    sentAt: new Date().toISOString(),
    type,
    payload,
  };
}

export function parseAgentMessage(raw: unknown) {
  return AgentToControllerMessageSchema.safeParse(raw);
}

export function parseControllerMessage(raw: unknown) {
  return ControllerToAgentMessageSchema.safeParse(raw);
}
