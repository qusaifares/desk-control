import { describe, expect, it, vi } from 'vitest';
import {
  buildCapabilitiesRequest,
  CapabilitiesReplyError,
  parseCapabilitiesFragment,
  readCapabilitiesString,
} from './capabilities-request.js';
import { toHex } from './vcp.js';

/** Builds a fragment reply the way a monitor would. */
function fragment(offset: number, text: string): number[] {
  const data = [...text].map((character) => character.charCodeAt(0));
  const body = [0x80 | (data.length + 3), 0xe3, (offset >> 8) & 0xff, offset & 0xff, ...data];
  const checksum = body.reduce((accumulator, byte) => accumulator ^ byte, 0x50 ^ 0x6e);
  return [0x6e, ...body, checksum];
}

describe('buildCapabilitiesRequest', () => {
  it('encodes the offset and omits the address bytes from the payload', () => {
    // 0x6E ^ 0x51 ^ 0x83 ^ 0xF3 ^ 0x00 ^ 0x00 = 0x4F
    expect(toHex(buildCapabilitiesRequest(0))).toBe('83f300004f');
  });

  it('encodes a two-byte offset big-endian', () => {
    const request = buildCapabilitiesRequest(0x0120);
    expect(request[2]).toBe(0x01);
    expect(request[3]).toBe(0x20);
  });
});

describe('parseCapabilitiesFragment', () => {
  it('extracts the offset and payload', () => {
    const parsed = parseCapabilitiesFragment(fragment(0, '(prot'));
    expect(parsed.offset).toBe(0);
    expect(String.fromCharCode(...parsed.data)).toBe('(prot');
  });

  it('finds the fragment despite leading padding', () => {
    const parsed = parseCapabilitiesFragment([0x00, 0x00, ...fragment(32, 'model')]);
    expect(parsed.offset).toBe(32);
    expect(String.fromCharCode(...parsed.data)).toBe('model');
  });

  it('rejects a response with no fragment in it', () => {
    expect(() => parseCapabilitiesFragment(new Uint8Array(12))).toThrow(CapabilitiesReplyError);
  });

  it('rejects a truncated fragment rather than returning partial bytes', () => {
    const truncated = fragment(0, '(prot(monitor)').slice(0, 6);
    expect(() => parseCapabilitiesFragment(truncated)).toThrow(CapabilitiesReplyError);
  });
});

describe('readCapabilitiesString', () => {
  it('reassembles a string across fragments and stops on the empty one', async () => {
    const chunks = ['(prot(monitor)', 'type(LCD)model(PA279CV)', 'vcp(10 12 60(11 12 0F)))'];
    let offset = 0;
    const exchange = vi.fn(async () => {
      const chunk = chunks.shift();
      if (chunk === undefined) return Uint8Array.from(fragment(offset, ''));
      const reply = Uint8Array.from(fragment(offset, chunk));
      offset += chunk.length;
      return reply;
    });

    const assembled = await readCapabilitiesString(exchange);
    expect(assembled).toBe('(prot(monitor)type(LCD)model(PA279CV)vcp(10 12 60(11 12 0F)))');
    // Three fragments plus the terminating empty one.
    expect(exchange).toHaveBeenCalledTimes(4);
  });

  it('gives up rather than spinning when a panel replays one fragment forever', async () => {
    const exchange = vi.fn(async () => Uint8Array.from(fragment(0, 'x')));
    const assembled = await readCapabilitiesString(exchange);
    // Bounded, not infinite.
    expect(exchange.mock.calls.length).toBeLessThanOrEqual(128);
    expect(assembled.length).toBeLessThanOrEqual(128);
  });
});
