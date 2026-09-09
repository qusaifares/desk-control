import { describe, expect, it } from 'vitest';
import { MockMonitorControlProvider } from './mock-monitor-control-provider.js';
import { SimulatedDesk, type SimulatedMonitorSpec } from './simulated-desk.js';

const spec = (overrides: Partial<SimulatedMonitorSpec> = {}): SimulatedMonitorSpec => ({
  stableId: 'monitor:1',
  detectedName: 'TEST MON',
  manufacturerId: 'TST',
  model: 'MON',
  serial: '0001',
  manufactureYear: 2024,
  capabilities: ['input-switch', 'read-active-input'],
  requiresActiveInput: true,
  switchDelayMs: 10,
  activeInputId: 'input-dp1',
  preferredInputId: 'input-dp1',
  inputs: [
    {
      id: 'input-dp1',
      connector: 'DisplayPort',
      ddcInputSourceValue: 0x0f,
      detectedName: 'DP1',
      connectedComputerId: 'computer:a',
      maxMode: null,
    },
    {
      id: 'input-hdmi1',
      connector: 'HDMI',
      ddcInputSourceValue: 0x11,
      detectedName: 'HDMI1',
      connectedComputerId: 'computer:b',
      maxMode: null,
    },
  ],
  ...overrides,
});

describe('SimulatedDesk', () => {
  it('changes the active input after the simulated panel delay', async () => {
    const desk = new SimulatedDesk([spec({ switchDelayMs: 30 })]);
    const promise = desk.switchInput({
      stableId: 'monitor:1',
      inputId: 'input-hdmi1',
      commandId: 'c1',
      timeoutMs: 1000,
    });

    // Mid-switch the panel is between inputs, not already on the target.
    expect(desk.get('monitor:1')?.switchingToInputId).toBe('input-hdmi1');
    expect(desk.get('monitor:1')?.activeInputId).toBe('input-dp1');

    await expect(promise).resolves.toEqual({ ok: true });
    expect(desk.get('monitor:1')?.activeInputId).toBe('input-hdmi1');
  });

  it('answers a replayed command id from cache without switching twice', async () => {
    const desk = new SimulatedDesk([spec()]);
    await desk.switchInput({
      stableId: 'monitor:1',
      inputId: 'input-hdmi1',
      commandId: 'c1',
      timeoutMs: 1000,
    });
    expect(desk.get('monitor:1')?.activeInputId).toBe('input-hdmi1');

    // Manually drag the panel back, as if the user pressed the physical button.
    const monitor = desk.get('monitor:1');
    if (monitor) monitor.activeInputId = 'input-dp1';

    await desk.switchInput({
      stableId: 'monitor:1',
      inputId: 'input-hdmi1',
      commandId: 'c1',
      timeoutMs: 1000,
    });
    expect(desk.get('monitor:1')?.activeInputId).toBe('input-dp1');
  });

  it('rejects a concurrent switch as busy instead of queueing it', async () => {
    const desk = new SimulatedDesk([spec({ switchDelayMs: 50 })]);
    const first = desk.switchInput({
      stableId: 'monitor:1',
      inputId: 'input-hdmi1',
      commandId: 'c1',
      timeoutMs: 1000,
    });
    const second = await desk.switchInput({
      stableId: 'monitor:1',
      inputId: 'input-dp1',
      commandId: 'c2',
      timeoutMs: 1000,
    });
    expect(second.error?.code).toBe('DEVICE_BUSY');
    await first;
  });

  it('refuses to switch a monitor that lacks the capability', async () => {
    const desk = new SimulatedDesk([spec({ capabilities: ['brightness'] })]);
    const result = await desk.switchInput({
      stableId: 'monitor:1',
      inputId: 'input-hdmi1',
      commandId: 'c1',
      timeoutMs: 1000,
    });
    expect(result.error?.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('surfaces injected faults', async () => {
    const desk = new SimulatedDesk([spec()]);
    desk.injectFault('monitor:1', { mode: 'fail', code: 'DEVICE_BUSY', message: 'panel refused' });
    const result = await desk.switchInput({
      stableId: 'monitor:1',
      inputId: 'input-hdmi1',
      commandId: 'c1',
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('panel refused');
  });
});

describe('MockMonitorControlProvider', () => {
  it('only discovers monitors the computer is actually cabled to', async () => {
    const desk = new SimulatedDesk([
      spec(),
      spec({
        stableId: 'monitor:2',
        serial: '0002',
        inputs: [
          {
            id: 'input-dp1',
            connector: 'DisplayPort',
            ddcInputSourceValue: 0x0f,
            detectedName: 'DP1',
            connectedComputerId: 'computer:b',
            maxMode: null,
          },
        ],
        activeInputId: 'input-dp1',
      }),
    ]);

    const providerA = new MockMonitorControlProvider(desk, 'computer:a');
    const discovered = await providerA.discoverMonitors();
    expect(discovered.map((monitor) => monitor.stableId)).toEqual(['monitor:1']);
    // Wiring discovery: the agent knows which input its own cable is in.
    expect(discovered[0]?.connectedViaInputId).toBe('input-dp1');
  });

  it('loses DDC reachability when its input is not the live one, like real hardware', async () => {
    const desk = new SimulatedDesk([spec()]);
    const providerA = new MockMonitorControlProvider(desk, 'computer:a');
    const providerB = new MockMonitorControlProvider(desk, 'computer:b');

    expect((await providerA.getObservedState())[0]?.reachability).toBe('reachable');
    expect((await providerB.getObservedState())[0]?.reachability).toBe('unreachable');

    await providerA.setInput({
      stableId: 'monitor:1',
      localHandle: 'x',
      inputId: 'input-hdmi1',
      ddcInputSourceValue: 0x11,
      commandId: 'c1',
      timeoutMs: 1000,
    });

    // Roles swap: A gave the panel away and can no longer talk to it.
    expect((await providerA.getObservedState())[0]?.reachability).toBe('unreachable');
    const observedB = (await providerB.getObservedState())[0];
    expect(observedB?.reachability).toBe('reachable');
    expect(observedB?.activeInputId).toBe('input-hdmi1');
  });

  it('never reports an input it was merely asked to select', async () => {
    const desk = new SimulatedDesk([spec()]);
    const providerA = new MockMonitorControlProvider(desk, 'computer:a');
    desk.injectFault('monitor:1', { mode: 'fail', code: 'DEVICE_BUSY', message: 'nope' });

    const result = await providerA.setInput({
      stableId: 'monitor:1',
      localHandle: 'x',
      inputId: 'input-hdmi1',
      ddcInputSourceValue: 0x11,
      commandId: 'c1',
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    expect((await providerA.getObservedState())[0]?.activeInputId).toBe('input-dp1');
  });
});
