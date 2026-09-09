import { DDC_DISPLAY_ADDRESS, DDC_HOST_ADDRESS } from './vcp.js';

/**
 * The DDC/CI capabilities request (VCP opcode 0xF3).
 *
 * Windows never needs this - dxva2.dll has a dedicated call - but on macOS the
 * only route to a monitor is raw I2C, so the capabilities string has to be
 * fetched a fragment at a time and reassembled.
 *
 * Like the rest of the framing, this lives in TypeScript rather than in the
 * platform helper so it can be tested without hardware. The helper only moves
 * bytes.
 *
 *   request  0x6E 0x51 0x83 0xF3 offsetHi offsetLo checksum
 *   reply    0x6E 0x8n 0xE3 offsetHi offsetLo <data...> checksum
 */
export const VCP_OPCODE_CAPABILITIES = 0xf3;
export const VCP_OPCODE_CAPABILITIES_REPLY = 0xe3;

/** A capabilities string longer than this is treated as a runaway reply. */
export const MAX_CAPABILITIES_LENGTH = 4096;

function xor(bytes: readonly number[]): number {
  return bytes.reduce((accumulator, byte) => accumulator ^ byte, 0);
}

export function buildCapabilitiesRequest(offset: number): Uint8Array {
  const withLength = [
    DDC_DISPLAY_ADDRESS,
    DDC_HOST_ADDRESS,
    0x83,
    VCP_OPCODE_CAPABILITIES,
    (offset >> 8) & 0xff,
    offset & 0xff,
  ];
  const frame = [...withLength, xor(withLength)];
  // The two address bytes travel out of band as chip and sub-address.
  return Uint8Array.from(frame.slice(2));
}

export interface CapabilitiesFragment {
  offset: number;
  data: Uint8Array;
}

export class CapabilitiesReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilitiesReplyError';
  }
}

/**
 * Locates a capabilities fragment by signature rather than at a fixed offset,
 * because platforms disagree about whether a read includes the address byte.
 */
export function parseCapabilitiesFragment(
  bytes: Uint8Array | readonly number[],
): CapabilitiesFragment {
  const data = Array.from(bytes);

  for (let index = 0; index + 4 < data.length; index += 1) {
    const lengthByte = data[index] ?? 0;
    if ((lengthByte & 0x80) === 0) continue;
    if (data[index + 1] !== VCP_OPCODE_CAPABILITIES_REPLY) continue;

    const payloadLength = lengthByte & 0x7f;
    // Payload is opcode + two offset bytes + the fragment itself.
    if (payloadLength < 3) continue;
    const fragmentLength = payloadLength - 3;
    const start = index + 4;
    if (start + fragmentLength > data.length) {
      throw new CapabilitiesReplyError('Capabilities fragment is truncated');
    }

    return {
      offset: ((data[index + 2] ?? 0) << 8) | (data[index + 3] ?? 0),
      data: Uint8Array.from(data.slice(start, start + fragmentLength)),
    };
  }

  throw new CapabilitiesReplyError('No capabilities reply found in the I2C response');
}

/**
 * Reassembles a whole capabilities string from fragments.
 *
 * Stops on an empty fragment, which is how a monitor signals the end. Also
 * stops if the offset fails to advance, so a panel that keeps replaying one
 * fragment cannot spin us forever.
 */
export async function readCapabilitiesString(
  exchange: (request: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  let offset = 0;
  let assembled = '';

  for (let iteration = 0; iteration < 128; iteration += 1) {
    const reply = await exchange(buildCapabilitiesRequest(offset));
    const fragment = parseCapabilitiesFragment(reply);
    if (fragment.data.length === 0) break;

    assembled += String.fromCharCode(...fragment.data);
    const nextOffset = offset + fragment.data.length;
    if (nextOffset <= offset) break;
    offset = nextOffset;

    if (assembled.length > MAX_CAPABILITIES_LENGTH) {
      throw new CapabilitiesReplyError('Capabilities string exceeded the maximum length');
    }
  }

  return assembled;
}
