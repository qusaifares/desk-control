import { describe, expect, it } from 'vitest';
import {
  buildGetVcpRequest,
  buildSetVcpRequest,
  fromHex,
  parseVcpReply,
  toHex,
  VcpReplyError,
} from './vcp.js';

describe('request framing', () => {
  it('builds a Get VCP request with a valid checksum', () => {
    const request = buildGetVcpRequest(0x60);
    expect(toHex(request.frame)).toBe('6e51820160dc');
    // 0x6E ^ 0x51 ^ 0x82 ^ 0x01 ^ 0x60 = 0xDC
    expect(request.frame[request.frame.length - 1]).toBe(0xdc);
  });

  it('omits the two address bytes from the I2C payload', () => {
    const request = buildGetVcpRequest(0x60);
    // Platform APIs carry destination and source out of band; repeating them
    // inside the buffer is the classic way to get a silent no-op.
    expect(toHex(request.payload)).toBe('820160dc');
    expect(request.payload.length).toBe(request.frame.length - 2);
  });

  it('builds a Set VCP request carrying a 16-bit value big-endian', () => {
    const request = buildSetVcpRequest(0x60, 0x0f);
    expect(toHex(request.frame)).toBe('6e518403' + '60' + '000f' + toHex([request.frame[7]!]));
    expect(request.frame[4]).toBe(0x60);
    expect(request.frame[5]).toBe(0x00);
    expect(request.frame[6]).toBe(0x0f);
  });

  it('encodes the length nibble from the payload size', () => {
    expect(buildGetVcpRequest(0x60).frame[2]).toBe(0x82);
    expect(buildSetVcpRequest(0x60, 0x0f).frame[2]).toBe(0x84);
  });
});

/** Builds a spec-correct reply the way a monitor would. */
function reply(options: {
  vcp?: number;
  type?: number;
  max?: number;
  current?: number;
  result?: number;
  checksum?: number;
}): number[] {
  const body = [
    0x88,
    0x02,
    options.result ?? 0x00,
    options.vcp ?? 0x60,
    options.type ?? 0x00,
    ((options.max ?? 0x12) >> 8) & 0xff,
    (options.max ?? 0x12) & 0xff,
    ((options.current ?? 0x0f) >> 8) & 0xff,
    (options.current ?? 0x0f) & 0xff,
  ];
  const checksum =
    options.checksum ?? body.reduce((accumulator, byte) => accumulator ^ byte, 0x50 ^ 0x6e);
  return [...body, checksum];
}

describe('parseVcpReply', () => {
  it('reads the current and maximum values', () => {
    const parsed = parseVcpReply(reply({ current: 0x0f, max: 0x12 }));
    expect(parsed.current).toBe(0x0f);
    expect(parsed.max).toBe(0x12);
    expect(parsed.vcpCode).toBe(0x60);
    expect(parsed.checksumValid).toBe(true);
  });

  it('finds the frame regardless of leading padding or an address byte', () => {
    // Platforms disagree about whether the read includes the address byte, so
    // the frame is located by signature rather than at a fixed offset.
    expect(parseVcpReply([0x6e, ...reply({ current: 0x11 })]).current).toBe(0x11);
    expect(parseVcpReply([0x00, 0x00, 0x6e, ...reply({ current: 0x11 })]).current).toBe(0x11);
  });

  it('returns values but flags a checksum it cannot verify', () => {
    const parsed = parseVcpReply(reply({ current: 0x0f, checksum: 0xaa }));
    expect(parsed.current).toBe(0x0f);
    expect(parsed.checksumValid).toBe(false);
  });

  it('rejects a reply whose result code says the feature is unsupported', () => {
    expect(() => parseVcpReply(reply({ result: 0x01 }))).toThrow(VcpReplyError);
  });

  it('rejects a buffer with no reply frame in it', () => {
    expect(() => parseVcpReply(new Uint8Array(16))).toThrow(VcpReplyError);
  });

  it('rejects a truncated read instead of guessing', () => {
    expect(() => parseVcpReply([0x88, 0x02, 0x00])).toThrow(VcpReplyError);
  });

  it('round-trips hex encoding used on the wire', () => {
    const request = buildSetVcpRequest(0x60, 0x12);
    expect(fromHex(toHex(request.payload))).toEqual(request.payload);
  });
});
