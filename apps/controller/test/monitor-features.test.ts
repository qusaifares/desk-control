import { EXAMPLE_MONITOR_IDS } from '@desk-control/config';
import { waitFor } from '@desk-control/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

const TOP = EXAMPLE_MONITOR_IDS.topLandscape;
const LEFT = EXAMPLE_MONITOR_IDS.leftPortrait;

describe('brightness', () => {
  it('reads what the panel reports rather than what was asked for', async () => {
    await waitFor(() => harness.snapshot().observed.monitors[TOP]?.brightness !== null, {
      message: 'brightness was never observed',
    });
    // The example panel starts at 65; nothing has changed it.
    expect(harness.snapshot().observed.monitors[TOP]?.brightness).toBe(65);
  });

  it('sets brightness through the same command lifecycle as an input switch', async () => {
    const result = harness.commands.setMonitorBrightness({
      monitorId: TOP,
      brightness: 30,
      origin: 'user',
    });
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;

    await waitFor(() => harness.store.commands.get(result.commandId)?.status === 'succeeded', {
      message: 'brightness command never succeeded',
    });
    await waitFor(() => harness.snapshot().observed.monitors[TOP]?.brightness === 30, {
      message: 'brightness was never observed at the new value',
    });
    expect(harness.desk.get(TOP)?.currentBrightness).toBe(30);
  });

  it('refuses a monitor that does not advertise brightness', () => {
    // The left rail is capability-poor on purpose: input switching only.
    const result = harness.commands.setMonitorBrightness({
      monitorId: LEFT,
      brightness: 30,
      origin: 'user',
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('does not cancel an input switch that is still in flight', () => {
    const input = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: 'computer:m4-macbook',
      origin: 'user',
    });
    const brightness = harness.commands.setMonitorBrightness({
      monitorId: TOP,
      brightness: 20,
      origin: 'user',
    });
    if (input.status !== 'accepted' || brightness.status !== 'accepted')
      throw new Error('rejected');

    // Different targets on the same monitor, so neither supersedes the other.
    expect(harness.store.commands.get(input.commandId)?.status).not.toBe('superseded');
    expect(harness.store.commands.get(brightness.commandId)?.status).not.toBe('superseded');
  });

  it('supersedes an earlier brightness request for the same monitor', () => {
    const first = harness.commands.setMonitorBrightness({
      monitorId: TOP,
      brightness: 10,
      origin: 'user',
    });
    harness.commands.setMonitorBrightness({ monitorId: TOP, brightness: 80, origin: 'user' });
    if (first.status !== 'accepted') throw new Error('rejected');
    expect(harness.store.commands.get(first.commandId)?.status).toBe('superseded');
  });
});

describe('display power', () => {
  it('turns a display off and reads the state back', async () => {
    const result = harness.commands.setMonitorPower({
      monitorId: TOP,
      powerState: 'off',
      origin: 'user',
    });
    if (result.status !== 'accepted') throw new Error('rejected');

    await waitFor(() => harness.store.commands.get(result.commandId)?.status === 'succeeded');
    expect(harness.desk.get(TOP)?.currentPowerState).toBe('off');
  });

  it('applies to every capable display at once, skipping the rest with a reason', async () => {
    const all = harness.commands.setAllMonitorsPower('standby');

    // Three of the four example panels support power; the left rail does not.
    expect(all.commandIds).toHaveLength(3);
    expect(all.skipped).toEqual([{ targetId: LEFT, reason: 'CAPABILITY_UNSUPPORTED' }]);

    await waitFor(
      () => all.commandIds.every((id) => harness.store.commands.get(id)?.status === 'succeeded'),
      { message: 'not every display settled' },
    );
    expect(harness.desk.get(LEFT)?.currentPowerState).toBe('on');
  });
});

describe('agents that do not support a command kind', () => {
  it('records what each agent claimed it can do', () => {
    for (const agent of harness.snapshot().agents) {
      expect(agent.supportedCommandKinds).toContain('set-monitor-input');
      expect(agent.supportedCommandKinds).toContain('set-monitor-brightness');
    }
  });

  it('refuses to dispatch a kind no online agent claims, instead of timing out', () => {
    // Simulate an older agent that only knows how to switch inputs.
    for (const agent of harness.store.agents.values()) {
      agent.supportedCommandKinds = ['set-monitor-input'];
    }

    const result = harness.commands.setMonitorBrightness({
      monitorId: TOP,
      brightness: 30,
      origin: 'user',
    });
    if (result.status !== 'accepted') throw new Error('rejected');

    const command = harness.store.commands.get(result.commandId);
    expect(command?.status).toBe('failed');
    expect(command?.error?.code).toBe('NO_CONTROL_PATH');
  });
});
