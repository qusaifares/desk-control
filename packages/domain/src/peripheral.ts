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
  /**
   * USB identity, as `vendor:product` (e.g. "046d:c52b").
   *
   * This is what makes peripheral ownership *observable*. A cheap KM switch
   * reports nothing about which port it is on, so the honest way to know where
   * the keyboard went is to ask the computers: whichever machine currently
   * enumerates this device is the one holding it. Without it, ownership can
   * only ever be inferred from commands we sent, which this system does not do.
   */
  usbId: z
    .string()
    .regex(/^[0-9a-f]{4}:[0-9a-f]{4}$/i, 'expected vendor:product, e.g. 046d:c52b')
    .nullable()
    .default(null),
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
  /**
   * How the controller actually operates it.
   *
   * `gpio` is the real case: these switches have no software interface, so the
   * Pi presses the remote's button through a pin. `mode` says whether that
   * remote has a button per port or one that cycles - which changes everything,
   * because a cycling remote cannot be moved without knowing where it is.
   */
  control: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('simulated'),
        switchDelayMs: z.number().int().nonnegative().default(900),
      }),
      z.object({
        kind: z.literal('gpio'),
        mode: z.enum(['direct', 'cycle']),
        /** direct: portId -> BCM pin. cycle: one entry, the advance button. */
        pins: z.record(z.string(), z.number().int().nonnegative()),
        pulseMs: z.number().int().positive().default(150),
        settleMs: z.number().int().positive().default(350),
        driver: z.enum(['pinctrl', 'gpiod']).default('pinctrl'),
        chip: z.string().default('gpiochip0'),
      }),
    ])
    .default({ kind: 'simulated', switchDelayMs: 900 }),
});
export type PeripheralSwitch = z.infer<typeof PeripheralSwitchSchema>;

export function findPortForComputer(
  peripheralSwitch: PeripheralSwitch,
  computerId: string,
): PeripheralSwitchPort | undefined {
  return peripheralSwitch.ports.find((port) => port.computerId === computerId);
}
