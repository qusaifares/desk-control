import { z } from 'zod';

/**
 * Identity rules for the whole system:
 *
 * 1. Every entity has a *stable* id that is derived from hardware facts
 *    (EDID, machine UUID, USB serial) - never from a volatile OS index
 *    such as "Display 1" or "/dev/i2c-4".
 * 2. Detected names come from hardware and may change between OS versions
 *    or driver updates. They are display sugar, never identity.
 * 3. Users may attach a custom name. It overrides the *presentation* only.
 */
export const IdSchema = z.string().min(1).max(200);

export type ComputerId = string;
export type AgentId = string;
export type MonitorId = string;
export type MonitorInputId = string;
export type PeripheralId = string;
export type PeripheralSwitchId = string;
export type PresetId = string;
export type CommandId = string;

/** Lower-cases and strips characters that would make an id awkward in URLs/logs. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Builds the stable monitor id from EDID-ish facts.
 *
 * Serial is included when available because two identical monitors on one desk
 * are the common case. When a monitor reports no serial we fall back to a
 * caller-supplied disambiguator (usually the physical port) and mark the id as
 * weak so the UI can eventually prompt the user to confirm the mapping.
 */
export function buildMonitorId(parts: {
  manufacturerId: string;
  model: string;
  serial?: string | undefined;
  disambiguator?: string | undefined;
}): { id: MonitorId; weak: boolean } {
  const base = [parts.manufacturerId, parts.model];
  if (parts.serial && parts.serial.trim().length > 0) {
    return { id: `monitor:${base.concat(parts.serial).map(slugify).join(':')}`, weak: false };
  }
  const disambiguator = parts.disambiguator ?? 'unknown';
  return { id: `monitor:${base.concat(disambiguator).map(slugify).join(':')}`, weak: true };
}

export function buildComputerId(parts: { machineId: string }): ComputerId {
  return `computer:${slugify(parts.machineId)}`;
}

export function buildAgentId(parts: { machineId: string }): AgentId {
  return `agent:${slugify(parts.machineId)}`;
}
