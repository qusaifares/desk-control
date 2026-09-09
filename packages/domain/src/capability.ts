import { z } from 'zod';

/**
 * Capabilities are the only thing the controller is allowed to reason about
 * when deciding whether an operation is possible. Nothing in the core may
 * branch on a monitor model, a vendor name or a platform string.
 */

export const MonitorCapabilitySchema = z.enum([
  'input-switch',
  'brightness',
  'contrast',
  'power',
  'volume',
  'osd-lock',
  'read-active-input',
]);
export type MonitorCapability = z.infer<typeof MonitorCapabilitySchema>;

export const ComputerCapabilitySchema = z.enum([
  'ddc-control',
  'wake-on-lan',
  'sleep',
  'power-off',
  'peripheral-switch-control',
  'report-active-display',
]);
export type ComputerCapability = z.infer<typeof ComputerCapabilitySchema>;

export const PeripheralSwitchCapabilitySchema = z.enum([
  'switch-port',
  'read-active-port',
  'per-peripheral-routing',
]);
export type PeripheralSwitchCapability = z.infer<typeof PeripheralSwitchCapabilitySchema>;

export type AnyCapability = MonitorCapability | ComputerCapability | PeripheralSwitchCapability;

export function hasCapability<T extends string>(capabilities: readonly T[], wanted: T): boolean {
  return capabilities.includes(wanted);
}

export function requireCapability<T extends string>(
  capabilities: readonly T[],
  wanted: T,
  subject: string,
): void {
  if (!hasCapability(capabilities, wanted)) {
    throw new CapabilityError(subject, wanted);
  }
}

export class CapabilityError extends Error {
  readonly code = 'CAPABILITY_UNSUPPORTED';
  constructor(
    readonly subject: string,
    readonly capability: string,
  ) {
    super(`${subject} does not support capability "${capability}"`);
    this.name = 'CapabilityError';
  }
}

/**
 * Merges capability sets reported by several control paths for the same
 * physical device. Union, not intersection: if *any* reachable path can switch
 * inputs then the monitor can switch inputs.
 */
export function unionCapabilities<T extends string>(sets: readonly (readonly T[])[]): T[] {
  return [...new Set(sets.flat())].sort();
}
