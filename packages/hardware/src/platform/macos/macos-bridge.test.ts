import { describe, expect, it } from 'vitest';
import type {
  DdcBridge,
  DdcListResponse,
  DdcObserveResponse,
  DdcGetVcpResponse,
} from '../../ddc/types.js';
import { fromHex, toHex } from '../../ddc/vcp.js';
import { MacOsDdcBridge } from './macos-bridge.js';

const CAPS = '(prot(monitor)type(LCD)model(PA279CV)vcp(10 12 60(11 12 0F))mccs_ver(2.2))';

/**
 * Emulates the compiled helper plus a monitor at the other end of the I2C bus.
 *
 * It decodes the frames this bridge builds and answers with spec-shaped
 * replies, so the test exercises the real framing round trip rather than a
 * mocked-out one.
 */
class FakeHelper implements DdcBridge {
  readonly calls: Array<{ op: string; params: Record<string, unknown> }> = [];
  activeInput = 0x0f;
  capabilities = CAPS;
  /** Make reads fail, as a panel on an inactive input does. */
  unreadable = false;
  /** Answer every query about VCP 0x60, as a panel with a stale reply does. */
  misreportVcp = false;
  edidHex: string | null =
    '00ffffffffffff0006b3682762db0500041f0103803c22783a1c95a75549a2260f5054230800d1c0814081809500b30081c00101010108e80030f2705a80b0588a0055502100001ea36600a0f0701f803020350055502100001a000000fd00283c1da03c000a202020202020000000fc00415355532050413237390a20200170020356f1510102031213040e0f1d1e1f9060615e5f5d2309070783010000e2006a6d030c002000383c2000600102036dd85dc401788003020000000000681a00000101283cf0e305e301e40f003000e606070161561c565e00a0a0a029503020350055502100001a4d6c80a070703e8030203a0055502100001a00000000006d';

  private staged: number[] = [];

  private frame(body: number[]): number[] {
    const checksum = body.reduce((accumulator, byte) => accumulator ^ byte, 0x50 ^ 0x6e);
    return [0x6e, ...body, checksum];
  }

  async request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ op, params });

    if (op === 'list') {
      return {
        monitors: [
          { deviceId: '4294968321', description: 'DCPAVServiceProxy', edidHex: this.edidHex },
        ],
      } as T;
    }

    if (op === 'write') {
      const payload = Array.from(fromHex(String(params.payloadHex)));
      const opcode = payload[1];

      if (opcode === 0x01) {
        // Get VCP feature.
        const vcp = this.misreportVcp ? 0x60 : (payload[2] ?? 0);
        const current = vcp === 0x60 ? this.activeInput : 0;
        this.staged = this.frame([
          0x88,
          0x02,
          0x00,
          vcp,
          0x00,
          0x00,
          0x12,
          (current >> 8) & 0xff,
          current & 0xff,
        ]);
      } else if (opcode === 0x03) {
        // Set VCP feature.
        if ((payload[2] ?? 0) === 0x60)
          this.activeInput = ((payload[3] ?? 0) << 8) | (payload[4] ?? 0);
        this.staged = [];
      } else if (opcode === 0xf3) {
        // Capabilities request: answer one fragment from the given offset.
        const offset = ((payload[2] ?? 0) << 8) | (payload[3] ?? 0);
        const chunk = this.capabilities.slice(offset, offset + 16);
        const data = [...chunk].map((character) => character.charCodeAt(0));
        this.staged = this.frame([
          0x80 | (data.length + 3),
          0xe3,
          (offset >> 8) & 0xff,
          offset & 0xff,
          ...data,
        ]);
      }
      return { written: true } as T;
    }

    if (op === 'read') {
      if (this.unreadable) throw new Error('IOAVServiceReadI2C failed');
      const length = Number(params.length ?? 12);
      const padded = [...this.staged];
      while (padded.length < length) padded.push(0x00);
      return { dataHex: toHex(padded.slice(0, Math.max(length, this.staged.length))) } as T;
    }

    throw new Error(`unexpected op ${op}`);
  }

  async dispose(): Promise<void> {}
}

function makeBridge(helper: FakeHelper) {
  return new MacOsDdcBridge({ raw: helper, transactionDelayMs: 0 });
}

describe('MacOsDdcBridge', () => {
  it('fetches the capabilities string over I2C, a fragment at a time', async () => {
    const helper = new FakeHelper();
    const listing = await makeBridge(helper).request<DdcListResponse>('list');

    expect(listing.monitors[0]?.capabilities).toBe(CAPS);
    expect(listing.monitors[0]?.capabilitiesError).toBeNull();
    // More than one fragment was needed for a string this long.
    expect(helper.calls.filter((call) => call.op === 'read').length).toBeGreaterThan(1);
  });

  it('returns EDID keyed by the same handle it reports for the monitor', async () => {
    const listing = await makeBridge(new FakeHelper()).request<DdcListResponse>('list');
    expect(listing.edid[0]?.key).toBe(listing.monitors[0]?.deviceId);
    expect(listing.edid[0]?.edidHex).toMatch(/^00ffffffffffff00/);
  });

  it('still reports a monitor that refuses to describe itself', async () => {
    const helper = new FakeHelper();
    helper.unreadable = true;
    const listing = await makeBridge(helper).request<DdcListResponse>('list');

    expect(listing.monitors).toHaveLength(1);
    expect(listing.monitors[0]?.capabilities).toBeNull();
    expect(listing.monitors[0]?.capabilitiesError).toContain('IOAVServiceReadI2C failed');
  });

  it('reads the live input by building and parsing real DDC frames', async () => {
    const helper = new FakeHelper();
    helper.activeInput = 0x12;
    const reply = await makeBridge(helper).request<DdcGetVcpResponse>('getvcp', {
      deviceId: '4294968321',
      code: 0x60,
    });
    expect(reply.value).toBe(0x12);
  });

  it('writes an input change that the emulated panel actually applies', async () => {
    const helper = new FakeHelper();
    const bridge = makeBridge(helper);
    await bridge.request('setvcp', { deviceId: '4294968321', code: 0x60, value: 0x11 });
    expect(helper.activeInput).toBe(0x11);

    const reply = await bridge.request<DdcGetVcpResponse>('getvcp', {
      deviceId: '4294968321',
      code: 0x60,
    });
    expect(reply.value).toBe(0x11);
  });

  it('rejects a stale reply that answers about a different VCP code', async () => {
    const helper = new FakeHelper();
    helper.misreportVcp = true;
    const bridge = makeBridge(helper);
    // Reading brightness must not silently return the input-source value.
    await expect(bridge.request('getvcp', { deviceId: '4294968321', code: 0x10 })).rejects.toThrow(
      /answered about VCP/,
    );
  });

  it('reports per-monitor failure in observe rather than failing the whole sweep', async () => {
    const helper = new FakeHelper();
    const bridge = makeBridge(helper);
    await bridge.request('list');

    helper.unreadable = true;
    const observed = await bridge.request<DdcObserveResponse>('observe');
    expect(observed.monitors[0]?.ok).toBe(false);
    expect(observed.monitors[0]?.value).toBeNull();
    expect(observed.monitors[0]?.error).toContain('IOAVServiceReadI2C failed');
  });

  it('refuses an operation the helper has no way to perform', async () => {
    await expect(makeBridge(new FakeHelper()).request('reboot-the-monitor')).rejects.toThrow(
      /cannot do/,
    );
  });
});
