import { describe, expect, it } from 'vitest';
import { GpioPeripheralSwitchProvider, type GpioSwitchConfig } from './gpio-peripheral-switch.js';
import { MockGpioPinDriver } from './pin-driver.js';

const PORTS = ['port-1', 'port-2', 'port-3', 'port-4'];

function make(overrides: Partial<GpioSwitchConfig> = {}) {
  const pins = new MockGpioPinDriver();
  const provider = new GpioPeripheralSwitchProvider(
    {
      switchId: 'switch:kvm',
      channels: ['default'],
      mode: 'direct',
      pins: { 'port-1': 17, 'port-2': 27, 'port-3': 22, 'port-4': 23 },
      portOrder: PORTS,
      pulseMs: 10,
      settleMs: 1,
      ...overrides,
    },
    pins,
  );
  return { provider, pins };
}

const request = (portId: string, currentPortId?: string | null) => ({
  switchId: 'switch:kvm',
  channelId: 'default',
  portId,
  currentPortId,
  commandId: `cmd-${portId}-${currentPortId ?? 'x'}`,
  timeoutMs: 5000,
});

describe('a remote with one button per port', () => {
  it('presses only the button for the port it was asked for', async () => {
    const { provider, pins } = make();
    const result = await provider.setPort(request('port-3'));

    expect(result.ok).toBe(true);
    expect(pins.pulses).toEqual([{ pin: 22, holdMs: 10 }]);
  });

  it('does not need to know where the switch currently is', async () => {
    const { provider, pins } = make();
    await provider.setPort(request('port-2', null));
    expect(pins.pulses).toHaveLength(1);
  });

  it('refuses a port with no pin wired to it', async () => {
    const { provider, pins } = make({ pins: { 'port-1': 17 } });
    const result = await provider.setPort(request('port-4'));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNKNOWN_TARGET');
    expect(pins.pulses).toHaveLength(0);
  });
});

describe('a remote that only cycles', () => {
  const cycle = { mode: 'cycle' as const, pins: { cycle: 17 } };

  it('presses once per step from where it is to where it should be', async () => {
    const { provider, pins } = make(cycle);
    await provider.setPort(request('port-3', 'port-1'));
    expect(pins.pulses.map((p) => p.pin)).toEqual([17, 17]);
  });

  it('wraps around the end rather than going backwards', async () => {
    const { provider, pins } = make(cycle);
    await provider.setPort(request('port-1', 'port-4'));
    expect(pins.pulses).toHaveLength(1);
  });

  it('refuses to press blind when it does not know where the switch is', async () => {
    const { provider, pins } = make(cycle);
    const result = await provider.setPort(request('port-3', null));

    // Counting presses and trusting the count desyncs the first time one is
    // missed, and stays wrong. Better to refuse and say why.
    expect(result.ok).toBe(false);
    expect(result.error?.retryable).toBe(true);
    expect(result.error?.message).toMatch(/cannot be moved without knowing which port/i);
    expect(pins.pulses).toHaveLength(0);
  });

  it('does nothing when it is already on the requested port', async () => {
    const { provider, pins } = make(cycle);
    const result = await provider.setPort(request('port-2', 'port-2'));
    expect(result.ok).toBe(true);
    expect(pins.pulses).toHaveLength(0);
  });
});

describe('honesty about what the hardware can tell us', () => {
  it('reports its port as unknown, because it genuinely cannot read it', async () => {
    const { provider } = make();
    const [state] = await provider.getObservedState();

    expect(state?.reachability).toBe('unknown');
    expect(state?.activePorts).toEqual({ default: null });
  });

  it('surfaces a wiring failure instead of claiming the press worked', async () => {
    const { provider, pins } = make();
    pins.failOnPin = 22;

    const result = await provider.setPort(request('port-3'));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('DEVICE_UNREACHABLE');
  });

  it('answers a replayed command id without pressing again', async () => {
    const { provider, pins } = make();
    await provider.setPort(request('port-2'));
    await provider.setPort(request('port-2'));
    expect(pins.pulses).toHaveLength(1);
  });
});
