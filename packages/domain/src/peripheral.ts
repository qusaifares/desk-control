import { z } from 'zod';
import { PeripheralSwitchCapabilitySchema } from './capability.js';
import { IdSchema } from './ids.js';
import { NameableSchema } from './naming.js';

export const PeripheralKindSchema = z.enum(['keyboard', 'mouse', 'audio', 'webcam', 'other']);
export type PeripheralKind = z.infer<typeof PeripheralKindSchema>;

/**
 * A shared peripheral is owned by exactly one computer at a time. Ownership is
 * changed by a hardware switch - the controller never proxies HID events.
 */
export const PeripheralSchema = NameableSchema.extend({
  id: IdSchema,
  kind: PeripheralKindSchema,
  switchId: IdSchema,
  /** Which switch channel this peripheral is physically plugged into. */
  channelId: IdSchema.nullable().default(null),
});
export type Peripheral = z.infer<typeof PeripheralSchema>;

export const PeripheralSwitchPortSchema = NameableSchema.extend({
  id: IdSchema,
  /** The computer wired to this port of the switch. */
  computerId: IdSchema.nullable().default(null),
});
export type PeripheralSwitchPort = z.infer<typeof PeripheralSwitchPortSchema>;

/**
 * A hardware USB switch. `channels` model switches that can route peripherals
 * independently; a simple 4-port KVM has a single channel covering everything.
 */
export const PeripheralSwitchSchema = NameableSchema.extend({
  id: IdSchema,
  kind: z.literal('peripheral-switch').default('peripheral-switch'),
  capabilities: z.array(PeripheralSwitchCapabilitySchema).default([]),
  ports: z.array(PeripheralSwitchPortSchema).default([]),
  channels: z.array(IdSchema).default(['default']),
  /**
   * Which component drives this switch. `controller` means the controller host
   * itself (GPIO / serial / USB-HID); an agent id means a computer does it.
   */
  driverBinding: z.union([z.literal('controller'), IdSchema]).default('controller'),
});
export type PeripheralSwitch = z.infer<typeof PeripheralSwitchSchema>;

export function findPortForComputer(
  peripheralSwitch: PeripheralSwitch,
  computerId: string,
): PeripheralSwitchPort | undefined {
  return peripheralSwitch.ports.find((port) => port.computerId === computerId);
}
