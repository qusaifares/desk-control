import { describe, expect, it } from 'vitest';
import { EdidParseError, parseEdidHex } from './edid.js';

/**
 * Real EDID blocks, read out of the Windows registry from four ASUS monitors.
 *
 * The first two are the panels this provider was developed against, and their
 * expected values below were cross-checked against what Windows WMI
 * independently reported for the same monitors. That equality is the point:
 * whatever reads the EDID - WMI on Windows, IOKit on macOS, sysfs on Linux -
 * every agent has to arrive at the same identity or control paths will not
 * merge.
 */
const PA278CV =
  '00ffffffffffff0006b36d27010101011a200104a53c22783be4a5a6544c9e260d5054bf4f00714f818081409500a940b300d100e1c0565e00a0a0a029503020350055502100001a000000fd001e4b70701e010a202020202020000000fc00504132373843560a2020202020000000ff004e364c4d51533133373332310a013b020323f14a900403021112131f05142309070783010000e2006a681a00000101304b007c2e00a0a0a015503020350055502100001a9774006ea0a034501720680855502100001a9e20009051201f304880360055502100001ccd4600a0a0381f4030203a0055502100001a0e1f008051001e304080370055502100001c00000e';

const PA279 =
  '00ffffffffffff0006b3682762db0500041f0103803c22783a1c95a75549a2260f5054230800d1c0814081809500b30081c00101010108e80030f2705a80b0588a0055502100001ea36600a0f0701f803020350055502100001a000000fd00283c1da03c000a202020202020000000fc00415355532050413237390a20200170020356f1510102031213040e0f1d1e1f9060615e5f5d2309070783010000e2006a6d030c002000383c2000600102036dd85dc401788003020000000000681a00000101283cf0e305e301e40f003000e606070161561c565e00a0a0a029503020350055502100001a4d6c80a070703e8030203a0055502100001a00000000006d';

const XG27AQM =
  '00ffffffffffff0006b31227010101011c1f0104b53c22783bf1a1b24a33bc250e5054bfef00714f81809500d1c00101010101010101565e00a0a0a029503020350055502100001c000000fd0c30f086866a010a202020202020000000fc00524f47205847323741514d0a20000000ff004d374c4d51533032373634340a0223020327f14c90111213040e0f1d1e1f403fe200eae305c0002309070783010000e6060501727200a4fb0070a0a015500820b80055502100001a9ee80078a0a067500820980455502100001a6fc200a0a0a055503020350055502100001a5aa000a0a0a046503020350055502100001a00000000000000000000000000000000d27012170000030114e09c0188ff099f002f801f009f05b200a400070044000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000090';

const VG27AQ1A =
  '00ffffffffffff0006b30727010101010e210104b53c22783b9325ad4f44a9260d5054bfef00714f81809500d1c00101010101010101565e00a0a0a029503020350055502100001c000000fd003090dfdf3b010a202020202020000000fc0056473237415131410a20202020000000ff0052344c4d51533032373034300a018d020327f14c90111213040e0f1d1e1f403f2309070783010000e305e001e6060701737300e2006a9ee80078a0a067500820980455502100001a6fc200a0a0a055503020350055502100001a5aa000a0a0a046503020350055502100001a00000000000000000000000000000000000000000000000000000000000000000000a1';

describe('parseEdidHex', () => {
  it('reproduces exactly what Windows WMI reported for the PA278CV', () => {
    const identity = parseEdidHex(PA278CV);
    expect(identity.manufacturerId).toBe('AUS');
    expect(identity.monitorName).toBe('PA278CV');
    expect(identity.serial).toBe('N6LMQS137321');
    expect(identity.productCode).toBe('276D');
    expect(identity.manufactureYear).toBe(2022);
  });

  it('falls back to the numeric serial when the panel has no serial descriptor', () => {
    // This monitor really does omit the 0xFF descriptor; WMI reported "383842",
    // which is the numeric serial in bytes 12-15.
    const identity = parseEdidHex(PA279);
    expect(identity.manufacturerId).toBe('AUS');
    expect(identity.monitorName).toBe('ASUS PA279');
    expect(identity.serial).toBe('383842');
    expect(identity.manufactureYear).toBe(2021);
  });

  it('reads monitors that are not currently attached', () => {
    expect(parseEdidHex(XG27AQM)).toMatchObject({
      manufacturerId: 'AUS',
      monitorName: 'ROG XG27AQM',
      serial: 'M7LMQS027644',
    });
    expect(parseEdidHex(VG27AQ1A)).toMatchObject({
      manufacturerId: 'AUS',
      monitorName: 'VG27AQ1A',
      serial: 'R4LMQS027040',
    });
  });

  it('derives the diagonal in inches from the physical size', () => {
    // All four are 27" panels: 60cm x 34cm.
    for (const block of [PA278CV, PA279, XG27AQM, VG27AQ1A]) {
      expect(parseEdidHex(block).physicalSizeInches).toBeCloseTo(27.2, 1);
    }
  });

  it('reports no size for a display that declares none', () => {
    const zeroed = PA278CV.slice(0, 42) + '0000' + PA278CV.slice(46);
    expect(parseEdidHex(zeroed).physicalSizeInches).toBeNull();
  });

  it('keeps four monitors of one brand distinct', () => {
    const serials = [PA278CV, PA279, XG27AQM, VG27AQ1A].map((block) => parseEdidHex(block).serial);
    expect(new Set(serials).size).toBe(4);
  });

  it('refuses the 0x01010101 placeholder serial that whole production runs ship with', () => {
    // The PA278CV carries that placeholder in bytes 12-15 and a real serial in
    // its descriptor; treating the placeholder as identity would collapse two
    // identical panels into one.
    const withoutDescriptor = PA278CV.replace(
      '000000ff004e364c4d51533133373332310a',
      '0000001000' + '00'.repeat(13),
    );
    expect(parseEdidHex(withoutDescriptor).serial).toBeNull();
  });

  it('tolerates whitespace and case in the hex input', () => {
    const spaced = (PA278CV.match(/../g) ?? []).join(' ').toUpperCase();
    expect(parseEdidHex(spaced).serial).toBe('N6LMQS137321');
  });

  it('rejects a block with no EDID header instead of inventing an identity', () => {
    expect(() => parseEdidHex('00'.repeat(128))).toThrow(EdidParseError);
  });

  it('rejects a truncated block', () => {
    expect(() => parseEdidHex(PA278CV.slice(0, 100))).toThrow(EdidParseError);
  });
});
