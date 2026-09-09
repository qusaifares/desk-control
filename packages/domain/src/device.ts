import { z } from 'zod';
import { ComputerCapabilitySchema } from './capability.js';
import { IdSchema } from './ids.js';
import { NameableSchema } from './naming.js';

export const PlatformSchema = z.enum(['windows', 'macos', 'linux', 'unknown']);
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Connectivity is deliberately a small closed set. `unknown` exists so the UI
 * can distinguish "we have never heard from this device" from "we heard from it
 * and it is down" - those need different affordances.
 */
export const ConnectivityStateSchema = z.enum(['online', 'degraded', 'offline', 'unknown']);
export type ConnectivityState = z.infer<typeof ConnectivityStateSchema>;

export const ConnectivitySchema = z.object({
  state: ConnectivityStateSchema,
  lastSeenAt: z.string().datetime().nullable(),
  /** Populated when state is degraded/offline so the UI can explain itself. */
  detail: z.string().nullable().optional(),
});
export type Connectivity = z.infer<typeof ConnectivitySchema>;

/**
 * A Computer is a source device on the desk. It exists in the model whether or
 * not an agent is currently running on it: a powered-off gaming PC is still
 * wired to monitor inputs and must still be selectable.
 */
export const ComputerSchema = NameableSchema.extend({
  id: IdSchema,
  kind: z.literal('computer').default('computer'),
  platform: PlatformSchema,
  capabilities: z.array(ComputerCapabilitySchema).default([]),
  /** The agent that speaks for this computer, when one has registered. */
  agentId: IdSchema.nullable().default(null),
  connectivity: ConnectivitySchema,
  metadata: z.record(z.string()).default({}),
});
export type Computer = z.infer<typeof ComputerSchema>;

/**
 * An Agent is the *process*; a Computer is the *machine*. They are 1:1 today but
 * are modelled separately because an agent can be restarted, upgraded, or
 * temporarily absent without the computer ceasing to exist.
 */
export const AgentSchema = NameableSchema.extend({
  id: IdSchema,
  computerId: IdSchema,
  platform: PlatformSchema,
  protocolVersion: z.number().int().positive(),
  agentVersion: z.string(),
  connectivity: ConnectivitySchema,
  /** Provider implementation backing this agent, e.g. "mock", "windows-ddc". */
  providerKind: z.string(),
  /**
   * Command kinds this agent claims it can carry out. The controller checks
   * this before dispatching, so an agent built before a command kind existed is
   * never sent work it would reject.
   */
  supportedCommandKinds: z.array(z.string()).default(['set-monitor-input']),
});
export type Agent = z.infer<typeof AgentSchema>;

export const ControllerInfoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  version: z.string(),
  protocolVersion: z.number().int().positive(),
  startedAt: z.string().datetime(),
});
export type ControllerInfo = z.infer<typeof ControllerInfoSchema>;
