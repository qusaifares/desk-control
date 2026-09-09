import { describe, expect, it } from 'vitest';
import { parseEdidHex } from './edid.js';
import { buildDdcMonitorIdentity, normalizeDeviceKey } from './identity.js';

describe('normalizeDeviceKey', () => {
  it('joins the two ways Windows names the same monitor', () => {
    // Both captured from the same real panel.
    const fromWmi = normalizeDeviceKey('DISPLAY\\AUS276D\\7&2d237c0c&0&UID16641_0');
    const fromInterface = normalizeDeviceKey(
      '\\\\?\\DISPLAY#AUS276D#7&2d237c0c&0&UID16641#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}',
    );
    expect(fromWmi).toBe(fromInterface);
    expect(fromWmi).toBe('display\\aus276d\\7&2d237c0c&0&uid16641');
  });

  it('keeps two monitors of the same model apart', () => {
    const first = normalizeDeviceKey('DISPLAY\\AUS276D\\7&2d237c0c&0&UID16641_0');
    const second = normalizeDeviceKey('DISPLAY\\AUS276D\\7&2d237c0c&0&UID16640_0');
    expect(first).not.toBe(second);
  });
});

describe('buildDdcMonitorIdentity', () => {
  const PA278CV_EDID =
    '00ffffffffffff0006b36d27010101011a200104a53c22783be4a5a6544c9e260d5054bf4f00714f818081409500a940b300d100e1c0565e00a0a0a029503020350055502100001a000000fd001e4b70701e010a202020202020000000fc00504132373843560a2020202020000000ff004e364c4d51533133373332310a013b020323f14a900403021112131f05142309070783010000e2006a681a00000101304b007c2e00a0a0a015503020350055502100001a9774006ea0a034501720680855502100001a9e20009051201f304880360055502100001ccd4600a0a0381f4030203a0055502100001a0e1f008051001e304080370055502100001c00000e';
  const edid = parseEdidHex(PA278CV_EDID);

  it('derives a stable id from EDID only, never from platform-shaped handles', () => {
    const identity = buildDdcMonitorIdentity({
      edid,
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY1',
    });
    expect(identity.stableId).toBe('monitor:aus:pa278cv:n6lmqs137321');
    expect(identity.weakIdentity).toBe(false);
    // The adapter name must not leak into identity: it changes between boots.
    expect(identity.stableId).not.toContain('display1');
  });

  it('computes the same id from a Windows handle and a macOS-style handle', () => {
    const fromWindows = buildDdcMonitorIdentity({
      edid,
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY1',
    });
    const fromMac = buildDdcMonitorIdentity({
      edid,
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: 'IOAVService:4',
    });
    // This equality is what lets the controller merge two agents' control paths.
    expect(fromWindows.stableId).toBe(fromMac.stableId);
  });

  it('falls back to the DDC-reported model and flags a weak identity with no serial', () => {
    const identity = buildDdcMonitorIdentity({
      edid: { ...edid, serial: null, monitorName: null },
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY1',
    });
    expect(identity.weakIdentity).toBe(true);
    expect(identity.serial).toBeNull();
    expect(identity.stableId).toContain('display1');
  });

  it('still yields an identity when EDID is unreadable entirely', () => {
    const identity = buildDdcMonitorIdentity({
      edid: null,
      capabilitiesModel: 'PA279CV',
      fallbackDisambiguator: 'IOAVService:2',
    });
    expect(identity.manufacturerId).toBe('UNK');
    expect(identity.model).toBe('PA279CV');
    expect(identity.weakIdentity).toBe(true);
  });
});
