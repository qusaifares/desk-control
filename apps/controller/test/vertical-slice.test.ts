import {
  EXAMPLE_COMPUTER_IDS,
  EXAMPLE_MONITOR_IDS,
  EXAMPLE_PERIPHERAL_IDS,
} from '@desk-control/config';
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

describe('agent discovery', () => {
  it('learns the desk from agent reports alone', () => {
    const snapshot = harness.snapshot();
    expect(snapshot.monitors).toHaveLength(4);
    expect(snapshot.agents).toHaveLength(4);
    expect(snapshot.agents.every((agent) => agent.connectivity.state === 'online')).toBe(true);

    // Wiring was discovered, not configured: each agent told us which input it
    // sits on, and the controller merged those into one monitor.
    const top = snapshot.monitors.find((monitor) => monitor.id === TOP);
    expect(top?.inputs.find((input) => input.id === 'input-dp1')?.connectedComputerId).toBe(
      EXAMPLE_COMPUTER_IDS.gamingPc,
    );
    expect(top?.inputs.find((input) => input.id === 'input-hdmi1')?.connectedComputerId).toBe(
      EXAMPLE_COMPUTER_IDS.m4MacBook,
    );
    expect(top?.controlPaths).toHaveLength(4);
  });

  it('shows every monitor live on the gaming PC at rest', () => {
    const snapshot = harness.snapshot();
    for (const monitor of snapshot.monitors) {
      const resolution = snapshot.resolutions.monitors[monitor.id];
      expect(resolution?.status).toBe('in-sync');
      expect(resolution?.observedSourceComputerId).toBe(EXAMPLE_COMPUTER_IDS.gamingPc);
    }
  });
});

describe('monitor switching lifecycle', () => {
  it('goes desired -> switching -> observed without ever faking the result', async () => {
    const result = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;

    // Immediately after the request the panel has not moved yet.
    const during = harness.snapshot().resolutions.monitors[TOP];
    expect(during?.status).toBe('switching');
    expect(during?.desiredSourceComputerId).toBe(EXAMPLE_COMPUTER_IDS.m4MacBook);
    expect(during?.observedSourceComputerId).toBe(EXAMPLE_COMPUTER_IDS.gamingPc);

    await waitFor(() => harness.snapshot().resolutions.monitors[TOP]?.status === 'in-sync', {
      message: 'monitor never reached in-sync',
    });

    const after = harness.snapshot();
    expect(after.resolutions.monitors[TOP]?.observedSourceComputerId).toBe(
      EXAMPLE_COMPUTER_IDS.m4MacBook,
    );
    expect(after.commands.find((command) => command.id === result.commandId)?.status).toBe(
      'succeeded',
    );
    // The simulated hardware really moved.
    expect(harness.desk.get(TOP)?.activeInputId).toBe('input-hdmi1');
  });

  it('routes the command through the agent that currently owns DDC access', async () => {
    const first = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (first.status !== 'accepted') throw new Error('rejected');
    await waitFor(() => harness.store.commands.get(first.commandId)?.status === 'succeeded');
    // The gaming PC owned the live input, so it drove the switch.
    expect(harness.store.commands.get(first.commandId)?.agentId).toBe('agent:gaming-pc');

    const second = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.surface,
      origin: 'user',
    });
    if (second.status !== 'accepted') throw new Error('rejected');
    await waitFor(() => harness.store.commands.get(second.commandId)?.status === 'succeeded');
    // Now the MacBook owns it, so the MacBook's agent had to do the work.
    expect(harness.store.commands.get(second.commandId)?.agentId).toBe('agent:m4-macbook');
  });

  it('rejects a source that is not physically wired to the monitor', () => {
    const result = harness.commands.setMonitorSource({
      monitorId: EXAMPLE_MONITOR_IDS.leftPortrait,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.surface,
      origin: 'user',
    });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('UNKNOWN_TARGET');
  });

  it('supersedes an in-flight command when the user changes their mind', async () => {
    const first = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    const second = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.surface,
      origin: 'user',
    });
    if (first.status !== 'accepted' || second.status !== 'accepted') throw new Error('rejected');

    expect(harness.store.commands.get(first.commandId)?.status).toBe('superseded');
    await waitFor(() => harness.snapshot().resolutions.monitors[TOP]?.status !== 'switching', {
      message: 'never settled',
    });
    expect(harness.store.desired.monitorSources[TOP]?.sourceComputerId).toBe(
      EXAMPLE_COMPUTER_IDS.surface,
    );
  });

  it('reports failure honestly when the panel refuses, leaving hardware untouched', async () => {
    harness.desk.injectFault(TOP, {
      mode: 'fail',
      code: 'DEVICE_BUSY',
      message: 'panel refused the input change',
    });

    const result = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (result.status !== 'accepted') throw new Error('rejected');

    await waitFor(() => harness.snapshot().resolutions.monitors[TOP]?.status === 'failed', {
      message: 'failure was never surfaced',
    });

    const snapshot = harness.snapshot();
    expect(snapshot.resolutions.monitors[TOP]?.observedSourceComputerId).toBe(
      EXAMPLE_COMPUTER_IDS.gamingPc,
    );
    expect(snapshot.resolutions.monitors[TOP]?.error?.message).toContain('panel refused');
    expect(harness.desk.get(TOP)?.activeInputId).toBe('input-dp1');
  });
});

describe('presets', () => {
  it('applies through the same command path as an individual switch', async () => {
    const result = harness.commands.applyPreset('preset:work');
    expect(result.status).toBe('accepted');
    expect(result.commandIds.length).toBeGreaterThan(1);

    // Every command a preset produces is an ordinary desk command.
    for (const commandId of result.commandIds) {
      expect(harness.store.commands.get(commandId)?.origin).toBe('preset');
      expect(harness.store.commands.get(commandId)?.presetId).toBe('preset:work');
    }

    // Wait on observed hardware, not just on command status.
    await waitFor(
      () =>
        harness.snapshot().resolutions.monitors[EXAMPLE_MONITOR_IDS.leftPortrait]
          ?.observedSourceComputerId === EXAMPLE_COMPUTER_IDS.m4MacBook,
      { message: 'preset never settled', timeoutMs: 8000 },
    );

    const snapshot = harness.snapshot();
    expect(
      snapshot.resolutions.monitors[EXAMPLE_MONITOR_IDS.topLandscape]?.observedSourceComputerId,
    ).toBe(EXAMPLE_COMPUTER_IDS.m4MacBook);
    expect(
      snapshot.resolutions.monitors[EXAMPLE_MONITOR_IDS.leftPortrait]?.observedSourceComputerId,
    ).toBe(EXAMPLE_COMPUTER_IDS.m4MacBook);
    // The right rail stays on the PC in this preset.
    expect(
      snapshot.resolutions.monitors[EXAMPLE_MONITOR_IDS.rightPortrait]?.observedSourceComputerId,
    ).toBe(EXAMPLE_COMPUTER_IDS.gamingPc);
    expect(snapshot.desired.activePresetId).toBe('preset:work');
  });

  it('moves keyboard and mouse together because they share one switch channel', async () => {
    harness.commands.applyPreset('preset:work');
    await waitFor(
      () =>
        harness.snapshot().resolutions.peripherals[EXAMPLE_PERIPHERAL_IDS.keyboard]?.status ===
        'in-sync',
      { message: 'peripherals never settled' },
    );

    const snapshot = harness.snapshot();
    expect(
      snapshot.resolutions.peripherals[EXAMPLE_PERIPHERAL_IDS.keyboard]?.observedOwnerComputerId,
    ).toBe(EXAMPLE_COMPUTER_IDS.m4MacBook);
    expect(
      snapshot.resolutions.peripherals[EXAMPLE_PERIPHERAL_IDS.mouse]?.observedOwnerComputerId,
    ).toBe(EXAMPLE_COMPUTER_IDS.m4MacBook);
  });

  it('reports unsatisfiable assignments as skips rather than failing the whole preset', () => {
    const withGhost = harness.store.config.presets.find((preset) => preset.id === 'preset:gaming');
    if (!withGhost) throw new Error('missing preset');
    withGhost.assignments.monitorSources['monitor:not-on-this-desk'] =
      EXAMPLE_COMPUTER_IDS.gamingPc;

    const result = harness.commands.applyPreset('preset:gaming');
    expect(result.status).toBe('accepted');
    expect(result.skipped.map((skip) => skip.targetId)).toContain('monitor:not-on-this-desk');
  });
});

describe('fail passive', () => {
  it('keeps desk state when an agent goes offline, and marks it offline', async () => {
    const before = harness.snapshot();
    const beforeSource = before.resolutions.monitors[TOP]?.observedSourceComputerId ?? null;
    expect(beforeSource).toBe(EXAMPLE_COMPUTER_IDS.gamingPc);

    await harness.stopAgent(EXAMPLE_COMPUTER_IDS.m4MacBook);
    await waitFor(
      () =>
        harness
          .snapshot()
          .agents.find((agent) => agent.computerId === EXAMPLE_COMPUTER_IDS.m4MacBook)?.connectivity
          .state === 'offline',
      { message: 'agent never went offline' },
    );

    const after = harness.snapshot();
    // The desk is untouched: same monitors, same wiring, same observed source.
    expect(after.monitors).toHaveLength(4);
    expect(after.resolutions.monitors[TOP]?.observedSourceComputerId).toBe(beforeSource);
    expect(
      after.computers.find((computer) => computer.id === EXAMPLE_COMPUTER_IDS.m4MacBook)
        ?.connectivity.state,
    ).toBe('offline');
    // And the simulated hardware really did not move.
    expect(harness.desk.get(TOP)?.activeInputId).toBe('input-dp1');
  });

  it('refuses a switch that needs an offline agent instead of pretending', async () => {
    // Hand the top monitor to the MacBook, then take that agent away.
    const first = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (first.status !== 'accepted') throw new Error('rejected');
    await waitFor(() => harness.store.commands.get(first.commandId)?.status === 'succeeded');

    await harness.stopAgent(EXAMPLE_COMPUTER_IDS.m4MacBook);
    await waitFor(() => !harness.server.gateway.isOnline('agent:m4-macbook'));

    const second = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.gamingPc,
      origin: 'user',
    });
    if (second.status !== 'accepted') throw new Error('rejected');

    const command = harness.store.commands.get(second.commandId);
    expect(command?.status).toBe('failed');
    expect(command?.error?.code).toBe('NO_CONTROL_PATH');
    // Intent is preserved so the UI can show what the user wanted.
    expect(harness.store.desired.monitorSources[TOP]?.sourceComputerId).toBe(
      EXAMPLE_COMPUTER_IDS.gamingPc,
    );
    expect(harness.desk.get(TOP)?.activeInputId).toBe('input-hdmi1');
  });

  it('recovers when the agent comes back', async () => {
    await harness.stopAgent(EXAMPLE_COMPUTER_IDS.surface);
    await waitFor(() => !harness.server.gateway.isOnline('agent:surface'));
    await harness.startAgent(EXAMPLE_COMPUTER_IDS.surface);
    await waitFor(() => harness.server.gateway.isOnline('agent:surface'), {
      message: 'agent did not reconnect',
    });
    expect(
      harness.snapshot().computers.find((computer) => computer.id === EXAMPLE_COMPUTER_IDS.surface)
        ?.connectivity.state,
    ).toBe('online');
  });
});
