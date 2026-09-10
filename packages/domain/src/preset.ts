import { z } from 'zod';
import { IdSchema } from './ids.js';
import { findInputForComputer, type Monitor } from './monitor.js';
import { NameableSchema } from './naming.js';
import type { Peripheral } from './peripheral.js';
import type { ObservedMonitorState, ObservedPeripheralState } from './state.js';

/**
 * Presets are DATA. They contain no behaviour and no special-cased application
 * logic: applying a preset produces exactly the same intents that clicking
 * monitors one at a time would produce, and those intents go down the same
 * command path.
 */
export const PresetAssignmentSchema = z.object({
  monitorSources: z.record(IdSchema, IdSchema).default({}),
  peripheralOwners: z.record(IdSchema, IdSchema).default({}),
});
export type PresetAssignment = z.infer<typeof PresetAssignmentSchema>;

export const PresetSchema = NameableSchema.extend({
  id: IdSchema,
  description: z.string().max(500).nullable().default(null),
  /** Free-form hint for the UI; never interpreted by the controller. */
  icon: z.string().nullable().default(null),
  assignments: PresetAssignmentSchema,
  sortOrder: z.number().int().default(0),
});
export type Preset = z.infer<typeof PresetSchema>;

export type PresetSkipReason =
  'monitor-unknown' | 'peripheral-unknown' | 'computer-not-wired' | 'already-desired';

export interface PresetIntent {
  target: 'monitor' | 'peripheral';
  /** monitorId or peripheralId */
  targetId: string;
  computerId: string;
  /** Resolved monitor input; null for peripherals. */
  inputId: string | null;
}

export interface PresetSkip {
  target: 'monitor' | 'peripheral';
  targetId: string;
  computerId: string;
  reason: PresetSkipReason;
}

export interface PresetPlan {
  presetId: string;
  intents: PresetIntent[];
  skipped: PresetSkip[];
}

export type CaptureSkipReason = 'not-observed' | 'unreachable';

export interface CapturedDeskState {
  assignments: PresetAssignment;
  /** Targets left out, with why. A preset should not invent what it cannot see. */
  skipped: Array<{ target: 'monitor' | 'peripheral'; targetId: string; reason: CaptureSkipReason }>;
}

/**
 * Captures what is on the desk right now as preset assignments.
 *
 * Reads OBSERVED state, not desired: "save this" means the arrangement you can
 * actually see, not the one that was last asked for and may have failed.
 *
 * Anything we cannot currently see is left out rather than guessed - a monitor
 * that is unreachable, or one that has never been observed, would otherwise be
 * baked into the preset as a stale assumption. The caller is told what was
 * skipped so it can say so.
 */
export function captureDeskState(input: {
  monitors: readonly Monitor[];
  peripherals: readonly Peripheral[];
  observedMonitors: Readonly<Record<string, ObservedMonitorState>>;
  observedPeripherals: Readonly<Record<string, ObservedPeripheralState>>;
}): CapturedDeskState {
  const assignments: PresetAssignment = { monitorSources: {}, peripheralOwners: {} };
  const skipped: CapturedDeskState['skipped'] = [];

  for (const monitor of input.monitors) {
    const observed = input.observedMonitors[monitor.id];
    // Order matters: an unreachable monitor also has no source, and "we cannot
    // reach it" is the more useful of the two reasons to report.
    if (observed?.reachability === 'unreachable') {
      skipped.push({ target: 'monitor', targetId: monitor.id, reason: 'unreachable' });
      continue;
    }
    if (!observed || observed.reachability === 'unknown' || !observed.activeSourceComputerId) {
      skipped.push({ target: 'monitor', targetId: monitor.id, reason: 'not-observed' });
      continue;
    }
    assignments.monitorSources[monitor.id] = observed.activeSourceComputerId;
  }

  for (const peripheral of input.peripherals) {
    const observed = input.observedPeripherals[peripheral.id];
    if (!observed || !observed.ownerComputerId) {
      skipped.push({ target: 'peripheral', targetId: peripheral.id, reason: 'not-observed' });
      continue;
    }
    assignments.peripheralOwners[peripheral.id] = observed.ownerComputerId;
  }

  return { assignments, skipped };
}

/**
 * Turns a preset into concrete intents against the *current* hardware.
 *
 * Unknown monitors and un-wired computers are reported as skips rather than
 * failures: a preset written for a five-monitor desk should still apply what it
 * can on a four-monitor desk. The caller decides how loudly to complain.
 */
export function planPreset(
  preset: Preset,
  context: {
    monitors: readonly Monitor[];
    peripherals: readonly Peripheral[];
    /** Desired source already recorded for a monitor, used to skip no-ops. */
    currentDesiredMonitorSource?: (monitorId: string) => string | null;
    currentDesiredPeripheralOwner?: (peripheralId: string) => string | null;
  },
): PresetPlan {
  const intents: PresetIntent[] = [];
  const skipped: PresetSkip[] = [];

  for (const [monitorId, computerId] of Object.entries(preset.assignments.monitorSources)) {
    const monitor = context.monitors.find((candidate) => candidate.id === monitorId);
    if (!monitor) {
      skipped.push({
        target: 'monitor',
        targetId: monitorId,
        computerId,
        reason: 'monitor-unknown',
      });
      continue;
    }
    const input = findInputForComputer(monitor, computerId);
    if (!input) {
      skipped.push({
        target: 'monitor',
        targetId: monitorId,
        computerId,
        reason: 'computer-not-wired',
      });
      continue;
    }
    if (context.currentDesiredMonitorSource?.(monitorId) === computerId) {
      skipped.push({
        target: 'monitor',
        targetId: monitorId,
        computerId,
        reason: 'already-desired',
      });
      continue;
    }
    intents.push({ target: 'monitor', targetId: monitorId, computerId, inputId: input.id });
  }

  for (const [peripheralId, computerId] of Object.entries(preset.assignments.peripheralOwners)) {
    const peripheral = context.peripherals.find((candidate) => candidate.id === peripheralId);
    if (!peripheral) {
      skipped.push({
        target: 'peripheral',
        targetId: peripheralId,
        computerId,
        reason: 'peripheral-unknown',
      });
      continue;
    }
    if (context.currentDesiredPeripheralOwner?.(peripheralId) === computerId) {
      skipped.push({
        target: 'peripheral',
        targetId: peripheralId,
        computerId,
        reason: 'already-desired',
      });
      continue;
    }
    intents.push({ target: 'peripheral', targetId: peripheralId, computerId, inputId: null });
  }

  return { presetId: preset.id, intents, skipped };
}
