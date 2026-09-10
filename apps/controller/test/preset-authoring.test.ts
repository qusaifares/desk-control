import { EXAMPLE_COMPUTER_IDS, EXAMPLE_MONITOR_IDS } from '@desk-control/config';
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

async function post(url: string, payload: unknown) {
  const response = await harness.server.app.inject({ method: 'POST', url, payload });
  return { status: response.statusCode, body: response.json() as Record<string, any> };
}

describe('saving the desk as a preset', () => {
  it('captures what is on screen and can reproduce it later', async () => {
    // Put the desk into a distinctive arrangement first.
    harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    await waitFor(
      () =>
        harness.snapshot().resolutions.monitors[TOP]?.observedSourceComputerId ===
        EXAMPLE_COMPUTER_IDS.m4MacBook,
    );

    const created = await post('/api/desk/presets/create', { detectedName: 'Reading' });
    expect(created.status).toBe(200);
    expect(created.body.presetId).toBe('preset:reading');

    const preset = harness.store.config.presets.find((p) => p.id === 'preset:reading');
    expect(preset?.assignments.monitorSources[TOP]).toBe(EXAMPLE_COMPUTER_IDS.m4MacBook);

    // Move the desk away, then apply the preset and confirm it comes back.
    harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.gamingPc,
      origin: 'user',
    });
    await waitFor(
      () =>
        harness.snapshot().resolutions.monitors[TOP]?.observedSourceComputerId ===
        EXAMPLE_COMPUTER_IDS.gamingPc,
    );

    harness.commands.applyPreset('preset:reading');
    await waitFor(
      () =>
        harness.snapshot().resolutions.monitors[TOP]?.observedSourceComputerId ===
        EXAMPLE_COMPUTER_IDS.m4MacBook,
      { message: 'preset did not restore the desk' },
    );
  });

  it('saves observed state, not what was merely requested', async () => {
    // Ask for something the hardware will refuse.
    harness.desk.injectFault(TOP, { mode: 'fail', code: 'DEVICE_BUSY', message: 'refused' });
    harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.surface,
      origin: 'user',
    });
    await waitFor(() => harness.snapshot().resolutions.monitors[TOP]?.status === 'failed');

    await post('/api/desk/presets/create', { detectedName: 'Honest' });
    const preset = harness.store.config.presets.find((p) => p.id === 'preset:honest');

    // The panel never moved, so the preset must record where it actually is.
    expect(preset?.assignments.monitorSources[TOP]).toBe(EXAMPLE_COMPUTER_IDS.gamingPc);
  });

  it('leaves out and reports anything it cannot currently see', async () => {
    harness.desk.injectFault(TOP, {
      mode: 'unreachable',
      code: 'DEVICE_UNREACHABLE',
      message: 'no reply',
    });
    await waitFor(() => harness.snapshot().observed.monitors[TOP]?.reachability === 'unreachable');

    const created = await post('/api/desk/presets/create', { detectedName: 'Partial' });
    const preset = harness.store.config.presets.find((p) => p.id === 'preset:partial');

    expect(preset?.assignments.monitorSources[TOP]).toBeUndefined();
    expect(created.body.skipped).toContainEqual({ targetId: TOP, reason: 'unreachable' });
  });

  it('gives distinct ids to presets with the same name', async () => {
    await post('/api/desk/presets/create', { detectedName: 'Work' });
    await post('/api/desk/presets/create', { detectedName: 'Work' });
    const ids = harness.store.config.presets.map((preset) => preset.id);
    expect(ids).toContain('preset:work');
    expect(ids).toContain('preset:work-2');
  });

  it('still saves the parts it can see when every display is unreachable', async () => {
    for (const monitor of harness.desk.list()) {
      harness.desk.injectFault(monitor.stableId, {
        mode: 'unreachable',
        code: 'DEVICE_UNREACHABLE',
        message: 'no reply',
      });
    }
    await waitFor(() =>
      Object.values(harness.snapshot().observed.monitors).every(
        (observed) => observed.reachability === 'unreachable',
      ),
    );

    const created = await post('/api/desk/presets/create', { detectedName: 'Peripherals only' });
    expect(created.status).toBe(200);

    const preset = harness.store.config.presets.find((p) => p.id === 'preset:peripherals-only');
    // The keyboard and mouse are still readable, so that much is worth saving.
    expect(Object.keys(preset!.assignments.monitorSources)).toHaveLength(0);
    expect(Object.keys(preset!.assignments.peripheralOwners).length).toBeGreaterThan(0);
    expect(created.body.skipped).toHaveLength(4);
  });

  it('refuses only when nothing on the desk can be seen at all', async () => {
    harness.store.config.peripherals = [];
    for (const monitor of harness.desk.list()) {
      harness.desk.injectFault(monitor.stableId, {
        mode: 'unreachable',
        code: 'DEVICE_UNREACHABLE',
        message: 'no reply',
      });
    }
    await waitFor(() =>
      Object.values(harness.snapshot().observed.monitors).every(
        (observed) => observed.reachability === 'unreachable',
      ),
    );

    const created = await post('/api/desk/presets/create', { detectedName: 'Nothing' });
    expect(created.status).toBe(409);
    expect(created.body.error.message).toMatch(/nothing to save/i);
  });
});

describe('editing presets', () => {
  it('updates a preset to the current desk', async () => {
    await post('/api/desk/presets/create', { detectedName: 'Scratch' });
    harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.surface,
      origin: 'user',
    });
    await waitFor(
      () =>
        harness.snapshot().resolutions.monitors[TOP]?.observedSourceComputerId ===
        EXAMPLE_COMPUTER_IDS.surface,
    );

    const updated = await post('/api/desk/presets/update', {
      presetId: 'preset:scratch',
      captureCurrent: true,
    });
    expect(updated.status).toBe(200);
    expect(
      harness.store.config.presets.find((p) => p.id === 'preset:scratch')?.assignments
        .monitorSources[TOP],
    ).toBe(EXAMPLE_COMPUTER_IDS.surface);
  });

  it('deletes a preset and stops calling it active', async () => {
    await post('/api/desk/presets/create', { detectedName: 'Temporary' });
    harness.commands.applyPreset('preset:temporary');
    expect(harness.store.desired.activePresetId).toBe('preset:temporary');

    const deleted = await post('/api/desk/presets/delete', { presetId: 'preset:temporary' });
    expect(deleted.status).toBe(200);
    expect(harness.store.config.presets.some((p) => p.id === 'preset:temporary')).toBe(false);
    expect(harness.store.desired.activePresetId).toBeNull();
  });

  it('404s on a preset that does not exist', async () => {
    expect((await post('/api/desk/presets/delete', { presetId: 'preset:ghost' })).status).toBe(404);
    expect(
      (await post('/api/desk/presets/update', { presetId: 'preset:ghost', captureCurrent: true }))
        .status,
    ).toBe(404);
  });
});
