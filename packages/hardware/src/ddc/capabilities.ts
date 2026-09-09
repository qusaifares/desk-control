import type { Connector, MonitorCapability } from '@desk-control/domain';

/**
 * Parser for the MCCS capabilities string a monitor returns from
 * CapabilitiesRequestAndCapabilitiesReply.
 *
 * Real examples from two ASUS panels on one desk - note that the second
 * sprinkles spaces between sections and the first does not, and that both
 * report a different set of VCP codes:
 *
 *   (prot(monitor)type(LCD)model(PA278CV)cmds(01 02 03 07 0C E3 F3)
 *    vcp(02 04 05 08 10 12 14(04 05 08 0B) 16 18 1A 52 60(11 0F 10) 62 ...)
 *    mswhql(1)asset_eep(40)mccs_ver(2.2))
 *
 *   (prot(monitor) type(LCD)model(PA279CV) cmds(01 02 03 07 0C F3)
 *    vcp(02 04 05 08 10 12 14(05 06 08 0B) 16 18 1A 52 60(11 12 0F) 62 ...)
 *    mccs_ver(2.2)asset_eep(32)mpu(01)mswhql(1))
 *
 * The capabilities string is the authority on which inputs exist. Do not infer
 * them from the `max` value of a VCP read: monitors disagree about what that
 * means, and one of the two panels above reports the input code as a
 * "momentary" type when it is plainly a set-parameter.
 */

export interface ParsedCapabilities {
  raw: string;
  model: string | null;
  type: string | null;
  mccsVersion: string | null;
  /** VCP code -> permitted values (empty array when the code takes a range). */
  vcp: Map<number, number[]>;
}

/** Splits `name(body)name2(body2)` at one nesting level, tolerating whitespace. */
function splitSections(input: string): Array<{ name: string; body: string }> {
  const sections: Array<{ name: string; body: string }> = [];
  let index = 0;

  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index] ?? '')) index += 1;

    let name = '';
    while (index < input.length && input[index] !== '(' && !/\s/.test(input[index] ?? '')) {
      name += input[index];
      index += 1;
    }
    while (index < input.length && /\s/.test(input[index] ?? '')) index += 1;

    if (input[index] !== '(') {
      // A bare token with no body. Nothing we need; skip it.
      if (name.length === 0) index += 1;
      continue;
    }

    let depth = 0;
    const start = index + 1;
    while (index < input.length) {
      if (input[index] === '(') depth += 1;
      else if (input[index] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }

    sections.push({ name: name.toLowerCase(), body: input.slice(start, index) });
    index += 1;
  }

  return sections;
}

/** Parses the body of `vcp(...)` into code -> permitted values. */
function parseVcpBody(body: string): Map<number, number[]> {
  const result = new Map<number, number[]>();
  let index = 0;

  while (index < body.length) {
    while (index < body.length && /\s/.test(body[index] ?? '')) index += 1;

    let token = '';
    while (index < body.length && /[0-9a-fA-F]/.test(body[index] ?? '')) {
      token += body[index];
      index += 1;
    }
    if (token.length === 0) {
      index += 1;
      continue;
    }

    const code = Number.parseInt(token, 16);
    if (Number.isNaN(code)) continue;

    let values: number[] = [];
    if (body[index] === '(') {
      let depth = 0;
      const start = index + 1;
      while (index < body.length) {
        if (body[index] === '(') depth += 1;
        else if (body[index] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        index += 1;
      }
      values = body
        .slice(start, index)
        .split(/\s+/)
        .filter((part) => part.length > 0)
        .map((part) => Number.parseInt(part, 16))
        .filter((value) => !Number.isNaN(value));
      index += 1;
    }

    result.set(code, values);
  }

  return result;
}

/**
 * Removes the single outer group, tolerating a truncated string.
 *
 * Truncated capability strings are a real occurrence - the reply is fetched in
 * chunks and monitors do get it wrong - so partial data is better than none.
 * Whatever we extract is only ever a hint: every switch is confirmed by reading
 * the panel back.
 */
function stripOuterGroup(trimmed: string): string {
  if (!trimmed.startsWith('(')) return trimmed;

  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '(') depth += 1;
    else if (trimmed[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index === trimmed.length - 1 ? trimmed.slice(1, index) : trimmed;
      }
    }
  }
  // Never closed: drop the opening paren and parse what arrived.
  return trimmed.slice(1);
}

export function parseCapabilities(raw: string): ParsedCapabilities {
  const trimmed = raw.trim();
  const inner = stripOuterGroup(trimmed);

  const sections = splitSections(inner);
  const find = (name: string) => sections.find((section) => section.name === name)?.body ?? null;

  return {
    raw,
    model: find('model')?.trim() ?? null,
    type: find('type')?.trim() ?? null,
    mccsVersion: find('mccs_ver')?.trim() ?? null,
    vcp: parseVcpBody(find('vcp') ?? ''),
  };
}

/* ------------------------------------------------------------------ *
 * VCP codes
 * ------------------------------------------------------------------ */

export const VCP_INPUT_SOURCE = 0x60;
const VCP_BRIGHTNESS = 0x10;
const VCP_CONTRAST = 0x12;
const VCP_AUDIO_VOLUME = 0x62;
const VCP_POWER_MODE = 0xd6;
const VCP_OSD_BUTTON_CONTROL = 0xca;

/**
 * Maps reported VCP codes onto domain capabilities.
 *
 * A monitor that does not advertise 0x60 cannot switch inputs, and the
 * controller will refuse the operation rather than issuing a write that the
 * panel silently ignores.
 */
export function capabilitiesFromVcp(vcp: Map<number, number[]>): MonitorCapability[] {
  const capabilities = new Set<MonitorCapability>();
  if (vcp.has(VCP_INPUT_SOURCE)) {
    capabilities.add('input-switch');
    capabilities.add('read-active-input');
  }
  if (vcp.has(VCP_BRIGHTNESS)) capabilities.add('brightness');
  if (vcp.has(VCP_CONTRAST)) capabilities.add('contrast');
  if (vcp.has(VCP_AUDIO_VOLUME)) capabilities.add('volume');
  if (vcp.has(VCP_POWER_MODE)) capabilities.add('power');
  if (vcp.has(VCP_OSD_BUTTON_CONTROL)) capabilities.add('osd-lock');
  return [...capabilities].sort();
}

/**
 * MCCS 2.2 input-source values.
 *
 * This is a *presentation* table taken from the spec - it turns a number into a
 * connector name and a label. It is not a device database and nothing branches
 * on a vendor or model. Unknown values are surfaced honestly rather than
 * dropped, because vendors do use codes outside the standard set (USB-C is
 * commonly 0x1B, which MCCS never defined).
 */
const INPUT_SOURCE_TABLE: Record<number, { connector: Connector; label: string }> = {
  0x01: { connector: 'VGA', label: 'VGA 1' },
  0x02: { connector: 'VGA', label: 'VGA 2' },
  0x03: { connector: 'DVI', label: 'DVI 1' },
  0x04: { connector: 'DVI', label: 'DVI 2' },
  0x05: { connector: 'unknown', label: 'Composite 1' },
  0x06: { connector: 'unknown', label: 'Composite 2' },
  0x07: { connector: 'unknown', label: 'S-Video 1' },
  0x08: { connector: 'unknown', label: 'S-Video 2' },
  0x09: { connector: 'unknown', label: 'Tuner 1' },
  0x0a: { connector: 'unknown', label: 'Tuner 2' },
  0x0b: { connector: 'unknown', label: 'Tuner 3' },
  0x0c: { connector: 'unknown', label: 'Component 1' },
  0x0d: { connector: 'unknown', label: 'Component 2' },
  0x0e: { connector: 'unknown', label: 'Component 3' },
  0x0f: { connector: 'DisplayPort', label: 'DisplayPort 1' },
  0x10: { connector: 'DisplayPort', label: 'DisplayPort 2' },
  0x11: { connector: 'HDMI', label: 'HDMI 1' },
  0x12: { connector: 'HDMI', label: 'HDMI 2' },
  // Not in MCCS, but widely used by monitors with a USB-C/Thunderbolt input.
  0x1b: { connector: 'USB-C', label: 'USB-C' },
  0x1c: { connector: 'USB-C', label: 'USB-C 2' },
};

export function describeInputSource(value: number): { connector: Connector; label: string } {
  return (
    INPUT_SOURCE_TABLE[value] ?? {
      connector: 'unknown',
      label: `Input 0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
    }
  );
}

/** Stable, agent-independent id for an input on a given monitor. */
export function inputIdForValue(value: number): string {
  return `input-0x${value.toString(16).padStart(2, '0')}`;
}

/** Permitted input-source values, in the order the monitor listed them. */
export function inputSourceValues(vcp: Map<number, number[]>): number[] {
  return vcp.get(VCP_INPUT_SOURCE) ?? [];
}
