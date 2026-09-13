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

describe('retrying a transient failure', () => {
  it('recovers on its own once the hardware comes back', async () => {
    // DDC really does fail like this: a panel mid-resync, a busy bus.
    harness.desk.injectFault(TOP, {
      mode: 'unreachable',
      code: 'DEVICE_UNREACHABLE',
      message: 'no reply',
    });

    const result = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (result.status !== 'accepted') throw new Error('rejected');

    await waitFor(() => (harness.store.commands.get(result.commandId)?.attempts ?? 0) >= 2, {
      message: 'never retried',
      timeoutMs: 8000,
    });

    harness.desk.injectFault(TOP, null);

    await waitFor(() => harness.store.commands.get(result.commandId)?.status === 'succeeded', {
      message: 'never recovered',
      timeoutMs: 10_000,
    });
    expect(harness.desk.get(TOP)?.activeInputId).toBe('input-hdmi1');
  });

  it('keeps the same command, so the UI shows switching rather than flickering', async () => {
    harness.desk.injectFault(TOP, {
      mode: 'unreachable',
      code: 'DEVICE_UNREACHABLE',
      message: 'no reply',
    });

    const result = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (result.status !== 'accepted') throw new Error('rejected');

    await waitFor(() => (harness.store.commands.get(result.commandId)?.attempts ?? 0) >= 2);
    // One command, several attempts - not a new command per try.
    expect(harness.store.commands.size).toBe(1);
    expect(harness.store.desired.monitorSources[TOP]?.commandId).toBe(result.commandId);
  });

  it('gives up after the configured number of attempts', async () => {
    harness.desk.injectFault(TOP, {
      mode: 'unreachable',
      code: 'DEVICE_UNREACHABLE',
      message: 'no reply',
    });

    const result = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (result.status !== 'accepted') throw new Error('rejected');

    await waitFor(() => (harness.store.commands.get(result.commandId)?.attempts ?? 0) >= 3, {
      timeoutMs: 8000,
    });
    // It must stop, not keep hammering a panel that is clearly not answering.
    await new Promise((resolve) => setTimeout(resolve, 900));

    const command = harness.store.commands.get(result.commandId);
    expect(command?.attempts).toBe(3);
    expect(command?.status).toBe('failed');
  });

  it('does not retry a failure that cannot be retried', async () => {
    harness.desk.injectFault(TOP, {
      mode: 'fail',
      code: 'DEVICE_BUSY',
      message: 'panel refused',
    });

    const result = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (result.status !== 'accepted') throw new Error('rejected');

    await waitFor(() => harness.store.commands.get(result.commandId)?.status === 'failed');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(harness.store.commands.get(result.commandId)?.attempts).toBe(1);
  });

  it('abandons a retry when the user asks for something else', async () => {
    harness.desk.injectFault(TOP, {
      mode: 'unreachable',
      code: 'DEVICE_UNREACHABLE',
      message: 'no reply',
    });

    const first = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      origin: 'user',
    });
    if (first.status !== 'accepted') throw new Error('rejected');
    await waitFor(() => harness.store.commands.get(first.commandId)?.status === 'failed');

    harness.desk.injectFault(TOP, null);
    const second = harness.commands.setMonitorSource({
      monitorId: TOP,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.surface,
      origin: 'user',
    });
    if (second.status !== 'accepted') throw new Error('rejected');

    await waitFor(() => harness.store.commands.get(second.commandId)?.status === 'succeeded');
    await new Promise((resolve) => setTimeout(resolve, 900));

    // The abandoned attempt must not resurrect and fight the newer one.
    expect(harness.desk.get(TOP)?.activeInputId).toBe('input-hdmi2');
  });
});
