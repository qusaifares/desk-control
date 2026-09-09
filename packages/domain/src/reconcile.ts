import { z } from 'zod';
import { type DeskCommand, isInFlight } from './command.js';
import type {
  DesiredMonitorSource,
  DesiredPeripheralOwner,
  ObservedMonitorState,
  ObservedPeripheralState,
} from './state.js';

/**
 * The single place where "what does the user see for this monitor?" is decided.
 *
 * unknown     never observed; do not guess
 * in-sync     observed matches desired (or nothing was ever requested)
 * switching   a command is in flight
 * failed      the last command ended badly and hardware did not reach the target
 * unreachable the agent that owns the control path cannot talk to the hardware
 * drifted     observed differs from desired with no command explaining it
 *             (someone pressed the physical input button, or a switch silently
 *             reverted) - deliberately distinct from `failed`
 */
export const SyncStatusSchema = z.enum([
  'unknown',
  'in-sync',
  'switching',
  'failed',
  'unreachable',
  'drifted',
]);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export interface MonitorResolution {
  status: SyncStatus;
  desiredSourceComputerId: string | null;
  observedSourceComputerId: string | null;
  inFlightCommandId: string | null;
  error: { code: string; message: string } | null;
}

export function resolveMonitorState(input: {
  desired: DesiredMonitorSource | undefined | null;
  observed: ObservedMonitorState | undefined | null;
  command: DeskCommand | undefined | null;
}): MonitorResolution {
  const desiredSourceComputerId = input.desired?.sourceComputerId ?? null;
  const observedSourceComputerId = input.observed?.activeSourceComputerId ?? null;

  const base = {
    desiredSourceComputerId,
    observedSourceComputerId,
    inFlightCommandId: null as string | null,
    error: null as MonitorResolution['error'],
  };

  // An in-flight command wins over everything: the hardware is mid-transition
  // and any observation we hold is known-stale.
  if (input.command && isInFlight(input.command.status)) {
    return { ...base, status: 'switching', inFlightCommandId: input.command.id };
  }

  if (!input.observed || input.observed.reachability === 'unknown') {
    return { ...base, status: 'unknown' };
  }

  if (input.observed.reachability === 'unreachable') {
    return {
      ...base,
      status: 'unreachable',
      error: input.observed.lastError ?? null,
    };
  }

  const reachedTarget =
    desiredSourceComputerId === null || desiredSourceComputerId === observedSourceComputerId;

  if (input.command && !reachedTarget) {
    if (input.command.status === 'failed' || input.command.status === 'timed-out') {
      return {
        ...base,
        status: 'failed',
        error: input.command.error
          ? { code: input.command.error.code, message: input.command.error.message }
          : { code: 'COMMAND_FAILED', message: `Command ${input.command.status}` },
      };
    }
  }

  if (reachedTarget) {
    return { ...base, status: 'in-sync' };
  }

  return { ...base, status: 'drifted' };
}

export interface PeripheralResolution {
  status: SyncStatus;
  desiredOwnerComputerId: string | null;
  observedOwnerComputerId: string | null;
  inFlightCommandId: string | null;
  error: { code: string; message: string } | null;
}

export function resolvePeripheralState(input: {
  desired: DesiredPeripheralOwner | undefined | null;
  observed: ObservedPeripheralState | undefined | null;
  command: DeskCommand | undefined | null;
}): PeripheralResolution {
  const monitorLike = resolveMonitorState({
    desired: input.desired
      ? {
          monitorId: input.desired.peripheralId,
          sourceComputerId: input.desired.ownerComputerId,
          requestedAt: input.desired.requestedAt,
          origin: input.desired.origin,
          commandId: input.desired.commandId,
          presetId: input.desired.presetId,
        }
      : null,
    observed: input.observed
      ? {
          monitorId: input.observed.peripheralId,
          activeInputId: null,
          activeSourceComputerId: input.observed.ownerComputerId,
          powerState: 'unknown',
          brightness: null,
          reachability: input.observed.reachability,
          observedAt: input.observed.observedAt,
          reportedByAgentId: null,
          lastError: input.observed.lastError,
        }
      : null,
    command: input.command,
  });

  return {
    status: monitorLike.status,
    desiredOwnerComputerId: monitorLike.desiredSourceComputerId,
    observedOwnerComputerId: monitorLike.observedSourceComputerId,
    inFlightCommandId: monitorLike.inFlightCommandId,
    error: monitorLike.error,
  };
}

/** Rolls per-target statuses into one headline the UI can show for a preset. */
export function aggregateStatus(statuses: readonly SyncStatus[]): SyncStatus {
  if (statuses.length === 0) return 'unknown';
  if (statuses.includes('switching')) return 'switching';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('unreachable')) return 'unreachable';
  if (statuses.includes('drifted')) return 'drifted';
  if (statuses.every((status) => status === 'in-sync')) return 'in-sync';
  return 'unknown';
}
