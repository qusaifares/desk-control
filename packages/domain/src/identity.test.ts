import { describe, expect, it } from 'vitest';
import {
  unionCapabilities,
  hasCapability,
  requireCapability,
  CapabilityError,
} from './capability.js';
import { buildMonitorId } from './ids.js';
import { MonitorSchema, selectControlPath } from './monitor.js';
import { displayName } from './naming.js';

describe('monitor identity', () => {
  it('derives the same stable id from the same EDID facts, whatever the OS index', () => {
    const fromWindows = buildMonitorId({
      manufacturerId: 'AUS',
      model: 'XG27AQM',
      serial: 'K1LMTF',
    });
    const fromMac = buildMonitorId({
      manufacturerId: 'aus',
      model: 'xg27aqm',
      serial: 'K1LMTF',
      disambiguator: 'Display 3',
    });
    expect(fromWindows.id).toBe(fromMac.id);
    expect(fromWindows.weak).toBe(false);
  });

  it('separates two identical panels by serial', () => {
    const first = buildMonitorId({ manufacturerId: 'AUS', model: 'XG27AQM', serial: '0001' });
    const second = buildMonitorId({ manufacturerId: 'AUS', model: 'XG27AQM', serial: '0002' });
    expect(first.id).not.toBe(second.id);
  });

  it('flags identity as weak when the monitor reports no serial', () => {
    const result = buildMonitorId({
      manufacturerId: 'AUS',
      model: 'PA248QV',
      disambiguator: 'DP-2',
    });
    expect(result.weak).toBe(true);
    expect(result.id).toContain('dp-2');
  });
});

describe('display names', () => {
  it('prefers the custom name but keeps the detected name underneath', () => {
    const monitor = MonitorSchema.parse({
      id: 'monitor:1',
      detectedName: 'ASUS XG27AQM',
      customName: 'Top',
      identity: { manufacturerId: 'AUS', model: 'XG27AQM' },
    });
    expect(displayName(monitor)).toBe('Top');
    expect(monitor.detectedName).toBe('ASUS XG27AQM');
  });

  it('falls back to the detected name when no custom name is set', () => {
    expect(displayName({ detectedName: 'DESKTOP-GAMING', customName: null })).toBe(
      'DESKTOP-GAMING',
    );
  });
});

describe('capabilities', () => {
  it('unions capabilities across control paths', () => {
    expect(unionCapabilities([['input-switch'], ['input-switch', 'brightness']])).toEqual([
      'brightness',
      'input-switch',
    ]);
  });

  it('throws a typed error naming the missing capability', () => {
    expect(() => requireCapability(['input-switch'], 'brightness', 'Left Rail')).toThrow(
      CapabilityError,
    );
    expect(hasCapability(['input-switch'], 'brightness')).toBe(false);
  });
});

describe('selectControlPath', () => {
  const monitor = MonitorSchema.parse({
    id: 'monitor:1',
    detectedName: 'MON',
    identity: { manufacturerId: 'AUS', model: 'X' },
    controlPaths: [
      {
        agentId: 'agent:a',
        computerId: 'computer:a',
        localHandle: 'a',
        inputId: 'input-dp1',
        capabilities: ['input-switch'],
        requiresActiveInput: true,
      },
      {
        agentId: 'agent:b',
        computerId: 'computer:b',
        localHandle: 'b',
        inputId: 'input-hdmi1',
        capabilities: ['input-switch'],
        requiresActiveInput: true,
      },
    ],
  });

  it('picks the agent sitting on the currently active input', () => {
    const path = selectControlPath(monitor, {
      activeInputId: 'input-hdmi1',
      isAgentOnline: () => true,
    });
    expect(path?.agentId).toBe('agent:b');
  });

  it('refuses to pick an offline agent', () => {
    const path = selectControlPath(monitor, {
      activeInputId: 'input-hdmi1',
      isAgentOnline: (agentId) => agentId !== 'agent:b',
    });
    // agent:a is online but requires the active input, which it does not have.
    expect(path).toBeUndefined();
  });

  it('falls back to an agent that can talk DDC from any input', () => {
    const relaxed = MonitorSchema.parse({
      ...monitor,
      controlPaths: monitor.controlPaths.map((path) => ({ ...path, requiresActiveInput: false })),
    });
    const path = selectControlPath(relaxed, {
      activeInputId: 'input-hdmi1',
      isAgentOnline: (agentId) => agentId === 'agent:a',
    });
    expect(path?.agentId).toBe('agent:a');
  });
});
