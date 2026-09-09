import { readCapabilitiesString } from '../../ddc/capabilities-request.js';
import { BridgeRequestError } from '../../ddc/process-bridge.js';
import type {
  DdcBridge,
  DdcGetVcpResponse,
  DdcListResponse,
  DdcObserveEntry,
  DdcObserveResponse,
} from '../../ddc/types.js';
import {
  buildGetVcpRequest,
  buildSetVcpRequest,
  fromHex,
  parseVcpReply,
  toHex,
} from '../../ddc/vcp.js';

/** What the compiled macOS helper returns. It only moves bytes. */
interface RawListResponse {
  monitors: Array<{ deviceId: string; description: string | null; edidHex: string | null }>;
}
interface RawReadResponse {
  dataHex: string;
}

export interface MacOsDdcBridgeOptions {
  raw: DdcBridge;
  /**
   * DDC/CI requires a pause between transactions; monitors that are hurried
   * simply stop answering. 50ms is the conventional floor.
   */
  transactionDelayMs?: number;
  /** Bytes to read for a VCP feature reply. */
  replyLength?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Turns the shared provider's high-level operations into raw I2C exchanges.
 *
 * On Apple Silicon there is no equivalent of dxva2.dll: the only route to a
 * monitor is I2C through IOAVService, so every DDC packet has to be built and
 * parsed by us. That work lives here and in `ddc/vcp.ts` - in TypeScript, under
 * test - rather than in the compiled helper, which stays thin enough to be
 * reviewed at a glance.
 */
export class MacOsDdcBridge implements DdcBridge {
  private readonly raw: DdcBridge;
  private readonly transactionDelayMs: number;
  private readonly replyLength: number;
  private deviceIds: string[] = [];

  constructor(options: MacOsDdcBridgeOptions) {
    this.raw = options.raw;
    this.transactionDelayMs = options.transactionDelayMs ?? 50;
    this.replyLength = options.replyLength ?? 12;
  }

  async request<TResult>(
    op: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<TResult> {
    switch (op) {
      case 'list':
        return (await this.list(timeoutMs)) as TResult;
      case 'observe':
        return (await this.observe(timeoutMs)) as TResult;
      case 'getvcp':
        return (await this.getVcp(
          String(params.deviceId),
          Number(params.code),
          timeoutMs,
        )) as TResult;
      case 'setvcp':
        return (await this.setVcp(
          String(params.deviceId),
          Number(params.code),
          Number(params.value),
          timeoutMs,
        )) as TResult;
      default:
        throw new BridgeRequestError('UNKNOWN_COMMAND_KIND', `macOS DDC bridge cannot do "${op}"`);
    }
  }

  private async list(timeoutMs: number): Promise<DdcListResponse> {
    const raw = await this.raw.request<RawListResponse>('list', {}, timeoutMs);
    const monitors = Array.isArray(raw.monitors) ? raw.monitors : [];
    this.deviceIds = monitors.map((monitor) => monitor.deviceId);

    const listing: DdcListResponse = { monitors: [], edid: [] };

    for (const monitor of monitors) {
      let capabilities: string | null = null;
      let capabilitiesError: string | null = null;
      try {
        capabilities = await readCapabilitiesString((request) =>
          this.exchange(monitor.deviceId, request),
        );
        if (capabilities.length === 0) {
          capabilities = null;
          capabilitiesError = 'Monitor returned an empty capabilities string';
        }
      } catch (error) {
        // A panel that will not describe itself is still worth reporting; the
        // provider will simply offer no inputs for it.
        capabilitiesError = (error as Error).message;
      }

      listing.monitors.push({
        deviceId: monitor.deviceId,
        description: monitor.description,
        capabilities,
        capabilitiesError,
        fallbackDisambiguator: monitor.deviceId,
      });

      if (monitor.edidHex) {
        listing.edid.push({ key: monitor.deviceId, edidHex: monitor.edidHex });
      }
    }

    return listing;
  }

  private async observe(timeoutMs: number): Promise<DdcObserveResponse> {
    if (this.deviceIds.length === 0) await this.list(timeoutMs);

    const monitors: DdcObserveEntry[] = [];
    for (const deviceId of this.deviceIds) {
      try {
        const reply = await this.getVcp(deviceId, 0x60, timeoutMs);
        monitors.push({ deviceId, ok: true, value: reply.value, error: null });
      } catch (error) {
        monitors.push({ deviceId, ok: false, value: null, error: (error as Error).message });
      }
    }
    return { monitors };
  }

  private async getVcp(
    deviceId: string,
    code: number,
    timeoutMs: number,
  ): Promise<DdcGetVcpResponse> {
    const reply = await this.exchange(deviceId, buildGetVcpRequest(code).payload, timeoutMs);
    const parsed = parseVcpReply(reply);
    if (parsed.vcpCode !== code) {
      throw new BridgeRequestError(
        'DEVICE_UNREACHABLE',
        `Display answered about VCP 0x${parsed.vcpCode.toString(16)}, not 0x${code.toString(16)}`,
      );
    }
    return { value: parsed.current, max: parsed.max, type: parsed.type };
  }

  private async setVcp(
    deviceId: string,
    code: number,
    value: number,
    timeoutMs: number,
  ): Promise<{ written: boolean }> {
    await this.write(deviceId, buildSetVcpRequest(code, value).payload, timeoutMs);
    await sleep(this.transactionDelayMs);
    return { written: true };
  }

  /** One DDC transaction: write a request, pause, read the reply. */
  private async exchange(
    deviceId: string,
    payload: Uint8Array,
    timeoutMs = 10_000,
  ): Promise<Uint8Array> {
    await this.write(deviceId, payload, timeoutMs);
    await sleep(this.transactionDelayMs);
    const reply = await this.raw.request<RawReadResponse>(
      'read',
      { deviceId, length: this.replyLength },
      timeoutMs,
    );
    await sleep(this.transactionDelayMs);
    return fromHex(reply.dataHex ?? '');
  }

  private async write(deviceId: string, payload: Uint8Array, timeoutMs: number): Promise<void> {
    await this.raw.request('write', { deviceId, payloadHex: toHex(payload) }, timeoutMs);
  }

  async dispose(): Promise<void> {
    await this.raw.dispose();
  }
}
