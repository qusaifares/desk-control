/**
 * DDC/CI wire framing.
 *
 * Windows does not need this: dxva2.dll builds the packets itself. macOS has no
 * equivalent - on Apple Silicon the only route to a monitor is raw I2C through
 * IOAVService - so the frames have to be constructed and parsed here.
 *
 * Keeping the framing in TypeScript rather than in the platform helper is
 * deliberate: it is the fiddliest part of DDC, and here it is unit-testable
 * without hardware, while the helper stays a thin transport that moves bytes.
 *
 * Frame layout, host to display:
 *
 *   0x6E  destination (the display's I2C address)
 *   0x51  source (the host)
 *   0x8n  0x80 | payload length
 *   ...   payload
 *   csum  XOR of every preceding byte
 */

export const DDC_DISPLAY_ADDRESS = 0x6e;
export const DDC_HOST_ADDRESS = 0x51;
/** 7-bit form of 0x6E, which is what I2C APIs expect. */
export const DDC_I2C_CHIP_ADDRESS = 0x37;

export const VCP_OPCODE_GET = 0x01;
export const VCP_OPCODE_GET_REPLY = 0x02;
export const VCP_OPCODE_SET = 0x03;

function xor(bytes: readonly number[]): number {
  return bytes.reduce((accumulator, byte) => accumulator ^ byte, 0);
}

export interface DdcRequest {
  /** The complete logical frame, including both addresses. For tests and logs. */
  frame: Uint8Array;
  /**
   * The bytes an I2C write should carry. Platform APIs take the destination as
   * a chip address and the source as a sub-address, so those two leading bytes
   * are supplied out-of-band and must not be repeated here.
   */
  payload: Uint8Array;
}

function build(body: readonly number[]): DdcRequest {
  const withLength = [DDC_DISPLAY_ADDRESS, DDC_HOST_ADDRESS, 0x80 | body.length, ...body];
  const frame = [...withLength, xor(withLength)];
  return {
    frame: Uint8Array.from(frame),
    payload: Uint8Array.from(frame.slice(2)),
  };
}

export function buildGetVcpRequest(vcpCode: number): DdcRequest {
  return build([VCP_OPCODE_GET, vcpCode]);
}

export function buildSetVcpRequest(vcpCode: number, value: number): DdcRequest {
  return build([VCP_OPCODE_SET, vcpCode, (value >> 8) & 0xff, value & 0xff]);
}

export interface VcpReply {
  vcpCode: number;
  /** 0x00 set-parameter, 0x01 momentary. Not trustworthy across vendors. */
  type: number;
  current: number;
  max: number;
  /**
   * False when no known checksum convention matched. The values are still
   * returned, because panels do get this wrong and refusing them outright would
   * make working monitors look broken - but a caller can log it.
   */
  checksumValid: boolean;
}

export class VcpReplyError extends Error {
  constructor(
    readonly reason: 'no-frame' | 'unsupported-vcp' | 'short',
    message: string,
  ) {
    super(message);
    this.name = 'VcpReplyError';
  }
}

/**
 * Extracts a VCP feature reply from whatever the platform handed back.
 *
 * The reply is *located by signature* rather than read at a fixed offset,
 * because platforms disagree about whether the read buffer includes the leading
 * address byte and some pad the start. Scanning for `0x88 0x02` - a reply of
 * length 8 carrying the Get-reply opcode - is stable across all of them.
 */
export function parseVcpReply(bytes: Uint8Array | readonly number[]): VcpReply {
  const data = Array.from(bytes);
  if (data.length < 10) {
    throw new VcpReplyError('short', `Reply was ${data.length} bytes, need at least 10`);
  }

  let start = -1;
  for (let index = 0; index + 9 < data.length; index += 1) {
    if (data[index] === 0x88 && data[index + 1] === VCP_OPCODE_GET_REPLY) {
      start = index;
      break;
    }
  }
  if (start === -1) {
    throw new VcpReplyError('no-frame', 'No VCP feature reply found in the I2C response');
  }

  const body = data.slice(start, start + 10);
  const resultCode = body[2] ?? 0xff;
  if (resultCode !== 0x00) {
    throw new VcpReplyError(
      'unsupported-vcp',
      `Display reported VCP result code 0x${resultCode.toString(16)}`,
    );
  }

  const checksum = body[9] ?? 0;
  const covered = xor(body.slice(0, 9));
  /*
   * The spec computes the reply checksum from the host's own bus address
   * (0x50), but implementations in the wild seed it differently. Accept any
   * convention that verifies rather than rejecting a monitor over it.
   */
  const seeds = [
    0x50 ^ DDC_DISPLAY_ADDRESS,
    DDC_DISPLAY_ADDRESS ^ DDC_HOST_ADDRESS,
    0x50,
    DDC_DISPLAY_ADDRESS,
    0x00,
  ];
  const checksumValid = seeds.some((seed) => (seed ^ covered) === checksum);

  return {
    vcpCode: body[3] ?? 0,
    type: body[4] ?? 0,
    max: ((body[5] ?? 0) << 8) | (body[6] ?? 0),
    current: ((body[7] ?? 0) << 8) | (body[8] ?? 0),
    checksumValid,
  };
}

/** Renders bytes as lowercase hex, for the wire protocol and for logs. */
export function toHex(bytes: Uint8Array | readonly number[]): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(Math.floor(cleaned.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(cleaned.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
