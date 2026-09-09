import { describe, expect, it } from 'vitest';
import { DdcMonitorControlProvider } from './ddc-provider.js';
import { BridgeRequestError } from './process-bridge.js';
import type { DdcBridge } from './types.js';

const DEVICE_ID =
  '\\\\?\\DISPLAY#AUS276D#7&2d237c0c&0&UID16641#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}';

const PA278CV_EDID =
  '00ffffffffffff0006b36d27010101011a200104a53c22783be4a5a6544c9e260d5054bf4f00714f818081409500a940b300d100e1c0565e00a0a0a029503020350055502100001a000000fd001e4b70701e010a202020202020000000fc00504132373843560a2020202020000000ff004e364c4d51533133373332310a013b020323f14a900403021112131f05142309070783010000e2006a681a00000101304b007c2e00a0a0a015503020350055502100001a9774006ea0a034501720680855502100001a9e20009051201f304880360055502100001ccd4600a0a0381f4030203a0055502100001a0e1f008051001e304080370055502100001c00000e';

const CAPS =
  '(prot(monitor)type(LCD)model(PA278CV)cmds(01 02 03 07 0C E3 F3)vcp(10 12 60(11 0F 10) 62 D6(01 04 05))mswhql(1)mccs_ver(2.2))';

/** Stands in for the PowerShell host, recording what the provider asked for. */
class FakeBridge implements DdcBridge {
  readonly calls: Array<{ op: string; params: Record<string, unknown> }> = [];
  capabilitiesString: string = CAPS;
  activeInput = 0x0f;
  /** Set to make every DDC read fail, as a panel does on an inactive input. */
  unreadable = false;
  /** Set to make the panel accept a write and ignore it. */
  ignoreWrites = false;
  listThrows: Error | null = null;

  async request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ op, params });
    if (this.listThrows && (op === 'list' || op === 'observe')) throw this.listThrows;

    switch (op) {
      case 'list':
        return {
          monitors: [
            {
              deviceId: DEVICE_ID,
              description: 'Generic PnP Monitor',
              capabilities: this.capabilitiesString,
              capabilitiesError: null,
              fallbackDisambiguator: '\\\\.\\DISPLAY1',
            },
          ],
          // The real EDID block for this panel, joined by device key.
          edid: [{ key: 'DISPLAY\\AUS276D\\7&2d237c0c&0&UID16641_0', edidHex: PA278CV_EDID }],
        } as T;

      case 'observe':
        if (this.unreadable) {
          return {
            monitors: [
              { deviceId: DEVICE_ID, ok: false, value: null, error: 'not the active input' },
            ],
          } as T;
        }
        return {
          monitors: [{ deviceId: DEVICE_ID, ok: true, value: this.activeInput, error: null }],
        } as T;

      case 'getvcp':
        if (this.unreadable) throw new BridgeRequestError('DEVICE_UNREACHABLE', 'no reply');
        return { value: this.activeInput, max: 0x12, type: 1 } as T;

      case 'setvcp':
        if (!this.ignoreWrites) this.activeInput = params.value as number;
        return { written: true } as T;

      default:
        throw new BridgeRequestError('UNKNOWN_COMMAND_KIND', op);
    }
  }

  async dispose(): Promise<void> {}
}

function makeProvider(bridge: FakeBridge) {
  return new DdcMonitorControlProvider({ kind: 'test-ddc', bridge, verifyIntervalMs: 1 });
}

describe('DdcMonitorControlProvider', () => {
  it('derives the stable id from raw EDID, so every platform computes the same one', async () => {
    const monitors = await makeProvider(new FakeBridge()).discoverMonitors();
    expect(monitors).toHaveLength(1);
    expect(monitors[0]?.stableId).toBe('monitor:aus:pa278cv:n6lmqs137321');
    expect(monitors[0]?.identity.serial).toBe('N6LMQS137321');
  });

  it('reports only the inputs the monitor actually advertises', async () => {
    const monitors = await makeProvider(new FakeBridge()).discoverMonitors();
    expect(monitors[0]?.inputs.map((input) => input.ddcInputSourceValue)).toEqual([
      0x11, 0x0f, 0x10,
    ]);
    expect(monitors[0]?.capabilities).toContain('input-switch');
  });

  it('infers which input this machine is cabled to from the live input', async () => {
    const bridge = new FakeBridge();
    bridge.activeInput = 0x10;
    const monitors = await makeProvider(bridge).discoverMonitors();
    expect(monitors[0]?.connectedViaInputId).toBe('input-0x10');
  });

  it('leaves wiring unknown rather than guessing when the panel will not answer', async () => {
    const bridge = new FakeBridge();
    bridge.unreadable = true;
    const monitors = await makeProvider(bridge).discoverMonitors();
    expect(monitors[0]?.connectedViaInputId).toBeNull();
  });

  it('reports unreachable rather than a stale value when DDC stops answering', async () => {
    const bridge = new FakeBridge();
    const provider = makeProvider(bridge);
    await provider.discoverMonitors();

    bridge.unreadable = true;
    const observed = await provider.getObservedState();
    expect(observed[0]?.reachability).toBe('unreachable');
    expect(observed[0]?.activeInputId).toBeNull();
  });

  it('reports every monitor unreachable when the bridge itself dies', async () => {
    const bridge = new FakeBridge();
    const provider = makeProvider(bridge);
    await provider.discoverMonitors();

    bridge.listThrows = new BridgeRequestError('DEVICE_UNREACHABLE', 'bridge exited');
    const observed = await provider.getObservedState();
    expect(observed[0]?.reachability).toBe('unreachable');
    expect(observed[0]?.error?.message).toContain('bridge exited');
  });

  it('switches the input and confirms by reading the panel back', async () => {
    const bridge = new FakeBridge();
    const provider = makeProvider(bridge);
    const monitors = await provider.discoverMonitors();

    const result = await provider.setInput({
      stableId: monitors[0]!.stableId,
      localHandle: monitors[0]!.localHandle,
      inputId: 'input-0x11',
      ddcInputSourceValue: 0x11,
      commandId: 'c1',
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(true);
    expect(bridge.calls.some((call) => call.op === 'setvcp' && call.params.value === 0x11)).toBe(
      true,
    );
    // Verified, not assumed: a read followed the write.
    expect(bridge.calls.filter((call) => call.op === 'getvcp').length).toBeGreaterThan(0);
  });

  it('fails when the panel accepts the write and ignores it', async () => {
    const bridge = new FakeBridge();
    bridge.ignoreWrites = true;
    const provider = makeProvider(bridge);
    const monitors = await provider.discoverMonitors();

    const result = await provider.setInput({
      stableId: monitors[0]!.stableId,
      localHandle: monitors[0]!.localHandle,
      inputId: 'input-0x11',
      ddcInputSourceValue: 0x11,
      commandId: 'c1',
      timeoutMs: 60,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('DEVICE_BUSY');
    expect(result.error?.message).toContain('stayed on input');
  });

  it('treats losing DDC after the write as a successful handover', async () => {
    const bridge = new FakeBridge();
    const provider = makeProvider(bridge);
    const monitors = await provider.discoverMonitors();

    // Handing the panel to another computer is exactly what makes it go quiet.
    bridge.unreadable = true;
    const result = await provider.setInput({
      stableId: monitors[0]!.stableId,
      localHandle: monitors[0]!.localHandle,
      inputId: 'input-0x11',
      ddcInputSourceValue: 0x11,
      commandId: 'c1',
      timeoutMs: 2000,
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a monitor that does not advertise input switching', async () => {
    const bridge = new FakeBridge();
    bridge.capabilitiesString = '(prot(monitor)model(BASIC)vcp(10 12))';
    const provider = makeProvider(bridge);
    const monitors = await provider.discoverMonitors();

    expect(monitors[0]?.capabilities).not.toContain('input-switch');
    expect(monitors[0]?.inputs).toHaveLength(0);

    const result = await provider.setInput({
      stableId: monitors[0]!.stableId,
      localHandle: monitors[0]!.localHandle,
      inputId: 'input-0x11',
      ddcInputSourceValue: 0x11,
      commandId: 'c1',
      timeoutMs: 500,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CAPABILITY_UNSUPPORTED');
  });

  it('answers a replayed command id from cache without touching hardware', async () => {
    const bridge = new FakeBridge();
    const provider = makeProvider(bridge);
    const monitors = await provider.discoverMonitors();

    const request = {
      stableId: monitors[0]!.stableId,
      localHandle: monitors[0]!.localHandle,
      inputId: 'input-0x11',
      ddcInputSourceValue: 0x11,
      commandId: 'c1',
      timeoutMs: 2000,
    };

    await provider.setInput(request);
    const writesAfterFirst = bridge.calls.filter((call) => call.op === 'setvcp').length;
    await provider.setInput(request);

    expect(bridge.calls.filter((call) => call.op === 'setvcp').length).toBe(writesAfterFirst);
  });
});
