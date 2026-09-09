/**
 * EDID parsing.
 *
 * This is the foundation of cross-platform identity. Windows can read a
 * monitor's identity from WMI and macOS can read it from IOKit, but both are
 * ultimately reporting fields out of the same EDID block - so parsing EDID
 * directly is what guarantees a Windows agent and a macOS agent compute the
 * *same* stable id for the same panel, which is what lets the controller merge
 * their control paths.
 *
 * Only the fields identity depends on are parsed. Timing descriptors, chromacity
 * and extension blocks are deliberately ignored.
 */

export interface EdidIdentity {
  /** Three-letter PNP id from bytes 8-9, e.g. "AUS". */
  manufacturerId: string;
  /** Product code from bytes 10-11, as uppercase hex, e.g. "276D". */
  productCode: string;
  /** Monitor name from the 0xFC descriptor, when present. */
  monitorName: string | null;
  /**
   * Serial, preferring the 0xFF descriptor string and falling back to the
   * numeric serial in bytes 12-15. Null when the panel reports neither.
   */
  serial: string | null;
  manufactureYear: number | null;
  manufactureWeek: number | null;
  /** Diagonal in inches from the physical size in EDID. Null for projectors. */
  physicalSizeInches: number | null;
}

const EDID_HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
const DESCRIPTOR_OFFSETS = [54, 72, 90, 108];
const DESCRIPTOR_MONITOR_NAME = 0xfc;
const DESCRIPTOR_SERIAL = 0xff;

export class EdidParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdidParseError';
  }
}

export function parseEdidHex(hex: string): EdidIdentity {
  const cleaned = hex.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length % 2 !== 0) throw new EdidParseError('EDID hex has an odd number of digits');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(cleaned.slice(index * 2, index * 2 + 2), 16);
  }
  return parseEdid(bytes);
}

/**
 * Decodes the three-letter manufacturer id.
 *
 * Bytes 8-9 hold three 5-bit letters, big-endian, where 1 = 'A'. This is why a
 * monitor's manufacturer shows up as "AUS" rather than "ASUS" everywhere in
 * this system - it is what the hardware actually reports.
 */
function readManufacturerId(bytes: Uint8Array): string {
  const value = ((bytes[8] ?? 0) << 8) | (bytes[9] ?? 0);
  const letters = [(value >> 10) & 0x1f, (value >> 5) & 0x1f, value & 0x1f];
  return letters
    .map((letter) => (letter >= 1 && letter <= 26 ? String.fromCharCode(64 + letter) : '?'))
    .join('');
}

/** Descriptor strings are ASCII, terminated by 0x0A and padded with spaces. */
function readDescriptorText(bytes: Uint8Array, offset: number): string {
  const raw = bytes.slice(offset + 5, offset + 18);
  let text = '';
  for (const byte of raw) {
    if (byte === 0x0a) break;
    text += String.fromCharCode(byte);
  }
  return text.replace(/\s+$/, '');
}

export function parseEdid(bytes: Uint8Array): EdidIdentity {
  if (bytes.length < 128) {
    throw new EdidParseError(`EDID block is ${bytes.length} bytes, expected at least 128`);
  }
  for (let index = 0; index < EDID_HEADER.length; index += 1) {
    if (bytes[index] !== EDID_HEADER[index]) {
      throw new EdidParseError('EDID header signature is missing');
    }
  }

  let monitorName: string | null = null;
  let descriptorSerial: string | null = null;

  for (const offset of DESCRIPTOR_OFFSETS) {
    // A display descriptor starts with 0x0000, then a zero, then its tag.
    if (bytes[offset] !== 0x00 || bytes[offset + 1] !== 0x00 || bytes[offset + 2] !== 0x00)
      continue;
    const tag = bytes[offset + 3];
    if (tag === DESCRIPTOR_MONITOR_NAME) monitorName = readDescriptorText(bytes, offset) || null;
    if (tag === DESCRIPTOR_SERIAL) descriptorSerial = readDescriptorText(bytes, offset) || null;
  }

  const numericSerial =
    ((bytes[15] ?? 0) << 24) |
    ((bytes[14] ?? 0) << 16) |
    ((bytes[13] ?? 0) << 8) |
    (bytes[12] ?? 0);

  /*
   * 0x01010101 is the placeholder a whole production run ships with. Treating
   * it as a serial would collapse two identical monitors onto one identity,
   * which is the single worst failure mode this system has.
   */
  const usableNumericSerial =
    numericSerial !== 0 && numericSerial >>> 0 !== 0x01010101 ? String(numericSerial >>> 0) : null;

  const week = bytes[16] ?? 0;
  const yearByte = bytes[17] ?? 0;

  // Bytes 21 and 22 are the screen size in centimetres. Both zero means the
  // display has no fixed size (a projector), not a zero-inch monitor.
  const widthCm = bytes[21] ?? 0;
  const heightCm = bytes[22] ?? 0;
  const physicalSizeInches =
    widthCm > 0 && heightCm > 0
      ? Math.round((Math.hypot(widthCm, heightCm) / 2.54) * 10) / 10
      : null;

  return {
    manufacturerId: readManufacturerId(bytes),
    productCode: (((bytes[11] ?? 0) << 8) | (bytes[10] ?? 0))
      .toString(16)
      .toUpperCase()
      .padStart(4, '0'),
    monitorName,
    serial: descriptorSerial ?? usableNumericSerial,
    manufactureYear: yearByte > 0 ? 1990 + yearByte : null,
    // Week 0xFF means the year field is a model year, not a manufacture date.
    manufactureWeek: week >= 1 && week <= 54 ? week : null,
    physicalSizeInches,
  };
}
