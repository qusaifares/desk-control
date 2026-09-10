import { describe, expect, it } from 'vitest';
import { MonitorSchema, type Monitor } from './monitor.js';
import type { Peripheral } from './peripheral.js';
import { captureDeskState, planPreset, PresetSchema } from './preset.js';

const monitor = (id: string, wiring: Record<string, string>): Monitor =>
  MonitorSchema.parse({
    id,
    detectedName: id,
    identity: { manufacturerId: 'AUS', model: 'X' },
    capabilities: ['input-switch'],
    inputs: Object.entries(wiring).map(([inputId, computerId]) => ({
      id: inputId,
      connector: 'DisplayPort',
      detectedName: inputId,
      connectedComputerId: computerId,
    })),
  });

const keyboard: Peripheral = {
  id: 'peripheral:kb',
  kind: 'keyboard',
  detectedName: 'Keyboard',
  customName: null,
  switchId: 'switch:1',
  channelId: 'default',
};

describe('planPreset', () => {
  const monitors = [
    monitor('monitor:top', { 'input-dp1': 'computer:pc', 'input-hdmi1': 'computer:mac' }),
    monitor('monitor:left', { 'input-dp1': 'computer:pc' }),
  ];

  it('resolves each assignment to a concrete monitor input', () => {
    const preset = PresetSchema.parse({
      id: 'preset:work',
      detectedName: 'Work',
      assignments: {
        monitorSources: { 'monitor:top': 'computer:mac' },
        peripheralOwners: { 'peripheral:kb': 'computer:mac' },
      },
    });

    const plan = planPreset(preset, { monitors, peripherals: [keyboard] });

    expect(plan.intents).toEqual([
      {
        target: 'monitor',
        targetId: 'monitor:top',
        computerId: 'computer:mac',
        inputId: 'input-hdmi1',
      },
      {
        target: 'peripheral',
        targetId: 'peripheral:kb',
        computerId: 'computer:mac',
        inputId: null,
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips - rather than fails - assignments this desk cannot satisfy', () => {
    const preset = PresetSchema.parse({
      id: 'preset:other-desk',
      detectedName: 'Other desk',
      assignments: {
        monitorSources: {
          'monitor:left': 'computer:mac', // wired to pc only
          'monitor:ghost': 'computer:pc', // monitor not on this desk
        },
        peripheralOwners: { 'peripheral:ghost': 'computer:pc' },
      },
    });

    const plan = planPreset(preset, { monitors, peripherals: [keyboard] });

    expect(plan.intents).toEqual([]);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        {
          target: 'monitor',
          targetId: 'monitor:left',
          computerId: 'computer:mac',
          reason: 'computer-not-wired',
        },
        {
          target: 'monitor',
          targetId: 'monitor:ghost',
          computerId: 'computer:pc',
          reason: 'monitor-unknown',
        },
        {
          target: 'peripheral',
          targetId: 'peripheral:ghost',
          computerId: 'computer:pc',
          reason: 'peripheral-unknown',
        },
      ]),
    );
  });

  it('skips assignments already requested so re-applying a preset is a no-op', () => {
    const preset = PresetSchema.parse({
      id: 'preset:pc',
      detectedName: 'PC',
      assignments: {
        monitorSources: { 'monitor:top': 'computer:pc', 'monitor:left': 'computer:pc' },
        peripheralOwners: {},
      },
    });

    const plan = planPreset(preset, {
      monitors,
      peripherals: [keyboard],
      currentDesiredMonitorSource: (monitorId) =>
        monitorId === 'monitor:top' ? 'computer:pc' : null,
    });

    expect(plan.intents.map((intent) => intent.targetId)).toEqual(['monitor:left']);
    expect(plan.skipped).toContainEqual({
      target: 'monitor',
      targetId: 'monitor:top',
      computerId: 'computer:pc',
      reason: 'already-desired',
    });
  });

  it('is pure data: the preset object carries no behaviour', () => {
    const preset = PresetSchema.parse({
      id: 'preset:json',
      detectedName: 'From JSON',
      assignments: { monitorSources: { 'monitor:top': 'computer:pc' }, peripheralOwners: {} },
    });
    // Round-tripping through JSON must not change what the preset does.
    const roundTripped = PresetSchema.parse(JSON.parse(JSON.stringify(preset)));
    expect(planPreset(roundTripped, { monitors, peripherals: [] })).toEqual(
      planPreset(preset, { monitors, peripherals: [] }),
    );
  });
});

describe('captureDeskState', () => {
  const observedMonitor = (
    monitorId: string,
    source: string | null,
    reachability: 'reachable' | 'unreachable' | 'unknown' = 'reachable',
  ) => ({
    monitorId,
    activeInputId: 'input-0x0f',
    activeSourceComputerId: source,
    powerState: 'on' as const,
    brightness: null,
    reachability,
    observedAt: '2026-01-01T00:00:00.000Z',
    reportedByAgentId: 'agent:a',
    lastError: null,
  });

  const monitors = [
    monitor('monitor:top', { 'input-dp1': 'computer:pc' }),
    monitor('monitor:left', { 'input-dp1': 'computer:pc' }),
  ];

  it('captures what is actually on screen', () => {
    const captured = captureDeskState({
      monitors,
      peripherals: [keyboard],
      observedMonitors: {
        'monitor:top': observedMonitor('monitor:top', 'computer:pc'),
        'monitor:left': observedMonitor('monitor:left', 'computer:mac'),
      },
      observedPeripherals: {
        'peripheral:kb': {
          peripheralId: 'peripheral:kb',
          ownerComputerId: 'computer:pc',
          reachability: 'reachable',
          observedAt: '2026-01-01T00:00:00.000Z',
          lastError: null,
        },
      },
    });

    expect(captured.assignments.monitorSources).toEqual({
      'monitor:top': 'computer:pc',
      'monitor:left': 'computer:mac',
    });
    expect(captured.assignments.peripheralOwners).toEqual({ 'peripheral:kb': 'computer:pc' });
    expect(captured.skipped).toEqual([]);
  });

  it('leaves out a monitor it cannot currently see, rather than guessing', () => {
    const captured = captureDeskState({
      monitors,
      peripherals: [],
      observedMonitors: {
        'monitor:top': observedMonitor('monitor:top', 'computer:pc'),
        'monitor:left': observedMonitor('monitor:left', null, 'unreachable'),
      },
      observedPeripherals: {},
    });

    expect(captured.assignments.monitorSources).toEqual({ 'monitor:top': 'computer:pc' });
    expect(captured.skipped).toEqual([
      { target: 'monitor', targetId: 'monitor:left', reason: 'unreachable' },
    ]);
  });

  it('leaves out a monitor that has never been observed', () => {
    const captured = captureDeskState({
      monitors,
      peripherals: [],
      observedMonitors: { 'monitor:top': observedMonitor('monitor:top', 'computer:pc') },
      observedPeripherals: {},
    });
    expect(captured.skipped).toEqual([
      { target: 'monitor', targetId: 'monitor:left', reason: 'not-observed' },
    ]);
  });

  it('round-trips: capturing then planning reproduces the same desk', () => {
    const captured = captureDeskState({
      monitors,
      peripherals: [],
      observedMonitors: {
        'monitor:top': observedMonitor('monitor:top', 'computer:pc'),
        'monitor:left': observedMonitor('monitor:left', 'computer:pc'),
      },
      observedPeripherals: {},
    });

    const preset = PresetSchema.parse({
      id: 'preset:captured',
      detectedName: 'Captured',
      assignments: captured.assignments,
    });

    const plan = planPreset(preset, { monitors, peripherals: [] });
    expect(plan.skipped).toEqual([]);
    expect(plan.intents.map((intent) => intent.targetId).sort()).toEqual([
      'monitor:left',
      'monitor:top',
    ]);
  });
});
