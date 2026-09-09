import { describe, expect, it } from 'vitest';
import { buildWindowsMonitorIdentity, normalizeDeviceKey } from './device-id.js';

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

describe('buildWindowsMonitorIdentity', () => {
  const edid = {
    instanceName: 'DISPLAY\\AUS276D\\7&2d237c0c&0&UID16641_0',
    manufacturerId: 'AUS',
    friendlyName: 'PA278CV',
    productCode: '276D',
    serial: 'N6LMQS137321',
    yearOfManufacture: 2022,
  };

  it('derives a stable id from EDID only, never from Windows-shaped paths', () => {
    const identity = buildWindowsMonitorIdentity({
      edid,
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY1',
    });
    expect(identity.stableId).toBe('monitor:aus:pa278cv:n6lmqs137321');
    expect(identity.weakIdentity).toBe(false);
    // The adapter name must not leak into identity: it changes between boots.
    expect(identity.stableId).not.toContain('display1');
  });

  it('produces the same id if the monitor moves to a different adapter', () => {
    const a = buildWindowsMonitorIdentity({
      edid,
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY1',
    });
    const b = buildWindowsMonitorIdentity({
      edid: { ...edid, instanceName: 'DISPLAY\\AUS276D\\7&other&0&UID99_0' },
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY4',
    });
    expect(a.stableId).toBe(b.stableId);
  });

  it('falls back to the DDC-reported model and flags a weak identity with no serial', () => {
    const identity = buildWindowsMonitorIdentity({
      edid: { ...edid, serial: null, friendlyName: null },
      capabilitiesModel: 'PA278CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY1',
    });
    expect(identity.weakIdentity).toBe(true);
    expect(identity.serial).toBeNull();
    expect(identity.stableId).toContain('display1');
  });

  it('still yields an identity when WMI is unavailable entirely', () => {
    const identity = buildWindowsMonitorIdentity({
      edid: null,
      capabilitiesModel: 'PA279CV',
      fallbackDisambiguator: '\\\\.\\DISPLAY2',
    });
    expect(identity.manufacturerId).toBe('UNK');
    expect(identity.model).toBe('PA279CV');
    expect(identity.weakIdentity).toBe(true);
  });
});
