import { describe, expect, it } from 'vitest';
import {
  capabilitiesFromVcp,
  describeInputSource,
  inputIdForValue,
  inputSourceValues,
  parseCapabilities,
} from './capabilities.js';

/**
 * Both strings below were captured verbatim from real monitors over DDC/CI.
 * They differ in whitespace, in which VCP codes they advertise, and in which
 * input-source values they permit - which is the whole reason this is parsed
 * rather than assumed.
 */
const PA278CV =
  '(prot(monitor)type(LCD)model(PA278CV)cmds(01 02 03 07 0C E3 F3)vcp(02 04 05 08 10 12 14(04 05 08 0B) 16 18 1A 52 60(11 0F 10) 62 AC AE B6 C0 C6 C8 C9 CC(01 02 03 04 05 06 07 08 09 0A 0C 0D 11 12 14 1A 1E 1F 23 26 27) D6(01 04 05) DC(00 0B 0D 0E 0F 17 18 21 22 23) DF)mswhql(1)asset_eep(40)mccs_ver(2.2))';

const PA279CV =
  '(prot(monitor) type(LCD)model(PA279CV) cmds(01 02 03 07 0C F3) vcp(02 04 05 08 10 12 14(05 06 08 0B) 16 18 1A 52 60(11 12 0F) 62 86(01 02 0B 0C) 87(00 0A 14 1E 28 32 3C 46 50 5A 64) 8A 8D(01 02) 92(00 0A 14 1E 28 32 3C 46 50 5A 64) AC AE B5(00 01) B6 C6 C8 CC(01 02 03 04 05 06 07 08 09 0A 0C 0D 11 12 14 1A 1E 1F 23 30 31) D6(01 05) DF DC(00 0B 0D 0E 0F 17 18 21 22 23) E0(01 02 03) E1(00 01) E2(00 14 28 3C 50 64) E3(00 19 32 4B 64) E4(00 01) E6(00 01 02 03 04) E7(00 01) E8(00 01) E9(00 01) EA(00 01) EB(00 01))mccs_ver(2.2)asset_eep(32)mpu(01)mswhql(1))';

describe('parseCapabilities', () => {
  it('reads a capabilities string with no spaces between sections', () => {
    const parsed = parseCapabilities(PA278CV);
    expect(parsed.model).toBe('PA278CV');
    expect(parsed.type).toBe('LCD');
    expect(parsed.mccsVersion).toBe('2.2');
  });

  it('reads a capabilities string that sprinkles spaces between sections', () => {
    const parsed = parseCapabilities(PA279CV);
    expect(parsed.model).toBe('PA279CV');
    expect(parsed.mccsVersion).toBe('2.2');
  });

  it('extracts the permitted input-source values in the order the monitor listed them', () => {
    expect(inputSourceValues(parseCapabilities(PA278CV).vcp)).toEqual([0x11, 0x0f, 0x10]);
    expect(inputSourceValues(parseCapabilities(PA279CV).vcp)).toEqual([0x11, 0x12, 0x0f]);
  });

  it('keeps codes that take a range distinct from codes with an enumerated list', () => {
    const vcp = parseCapabilities(PA278CV).vcp;
    // Brightness is continuous: present, but with no value list.
    expect(vcp.get(0x10)).toEqual([]);
    // Power mode enumerates its states.
    expect(vcp.get(0xd6)).toEqual([0x01, 0x04, 0x05]);
  });

  it('parses deeply nested value lists without losing following codes', () => {
    const vcp = parseCapabilities(PA279CV).vcp;
    expect(vcp.get(0xcc)).toContain(0x31);
    // EB comes after many nested lists and must still be seen.
    expect(vcp.get(0xeb)).toEqual([0x00, 0x01]);
  });

  it('survives a malformed string instead of throwing', () => {
    const parsed = parseCapabilities('(prot(monitor)vcp(60(11');
    expect(parsed.vcp.has(0x60)).toBe(true);
  });
});

describe('capabilitiesFromVcp', () => {
  it('derives domain capabilities from the advertised VCP codes', () => {
    expect(capabilitiesFromVcp(parseCapabilities(PA278CV).vcp)).toEqual([
      'brightness',
      'contrast',
      'input-switch',
      'power',
      'read-active-input',
      'volume',
    ]);
  });

  it('withholds input-switch from a monitor that does not advertise VCP 0x60', () => {
    const parsed = parseCapabilities('(prot(monitor)model(BASIC)vcp(10 12))');
    const capabilities = capabilitiesFromVcp(parsed.vcp);
    expect(capabilities).toEqual(['brightness', 'contrast']);
    expect(capabilities).not.toContain('input-switch');
  });
});

describe('input source values', () => {
  it('maps the MCCS standard values to connectors', () => {
    expect(describeInputSource(0x0f)).toEqual({ connector: 'DisplayPort', label: 'DisplayPort 1' });
    expect(describeInputSource(0x11)).toEqual({ connector: 'HDMI', label: 'HDMI 1' });
    expect(describeInputSource(0x1b)).toEqual({ connector: 'USB-C', label: 'USB-C' });
  });

  it('surfaces an unknown vendor value rather than dropping the input', () => {
    const described = describeInputSource(0x42);
    expect(described.connector).toBe('unknown');
    expect(described.label).toBe('Input 0x42');
  });

  it('produces input ids that are stable and independent of enumeration order', () => {
    expect(inputIdForValue(0x0f)).toBe('input-0x0f');
    expect(inputIdForValue(0x11)).toBe('input-0x11');
  });
});
