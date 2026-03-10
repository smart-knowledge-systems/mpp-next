import { MppUtility } from "./MppUtility.ts";

export interface PropsSummary {
  signature: number;
  version: number;
  propertyCount: number;
  rawLength: number;
  utf16Preview: string[];
}

export class Props {
  constructor(
    public readonly raw: Uint8Array,
    public readonly summary: PropsSummary,
    private readonly values: Map<number, Uint8Array>,
  ) {}

  getByteArray(type: number): Uint8Array | null {
    return this.values.get(type) ?? null;
  }

  getTimestamp(type: number): Date | null {
    const value = this.getByteArray(type);
    return value ? MppUtility.getTimestampValue(value, 0) : null;
  }

  static fromBuffer(raw: Uint8Array): Props {
    const propertyCount = raw.length >= 14 ? MppUtility.getUShort(raw, 12) : 0;
    const values = new Map<number, Uint8Array>();
    let offset = 16;
    let foundCount = 0;

    while (foundCount < propertyCount && offset + 12 <= raw.length) {
      const length = MppUtility.getInt(raw, offset);
      const propertyId = MppUtility.getInt(raw, offset + 4);
      offset += 12;

      if (length < 1 || offset + length > raw.length) {
        break;
      }

      values.set(propertyId, raw.subarray(offset, offset + length));
      offset += length;
      if (length % 2 !== 0) {
        offset += 1;
      }
      foundCount += 1;
    }

    return new Props(
      raw,
      {
        signature: raw.length >= 4 ? MppUtility.getUInt(raw, 0) : 0,
        version: raw.length >= 8 ? MppUtility.getUInt(raw, 4) : 0,
        propertyCount,
        rawLength: raw.length,
        utf16Preview: extractUtf16Strings(raw).slice(0, 8),
      },
      values,
    );
  }

  static parseSummaryInformation(raw: Uint8Array): {
    title: string | null;
    author: string | null;
  } {
    if (raw.length < 52) {
      return { title: null, author: null };
    }

    const sectionOffset = MppUtility.getUInt(raw, 44);
    if (sectionOffset + 8 > raw.length) {
      return { title: null, author: null };
    }

    const propertyCount = MppUtility.getUInt(raw, sectionOffset + 4);
    const properties = new Map<number, number>();

    for (let index = 0; index < propertyCount; index += 1) {
      const entryOffset = sectionOffset + 8 + index * 8;
      if (entryOffset + 8 > raw.length) {
        break;
      }
      properties.set(
        MppUtility.getUInt(raw, entryOffset),
        MppUtility.getUInt(raw, entryOffset + 4),
      );
    }

    return {
      title: readHpsfString(raw, sectionOffset, properties.get(2)),
      author: readHpsfString(raw, sectionOffset, properties.get(4)),
    };
  }
}

function extractUtf16Strings(raw: Uint8Array): string[] {
  const decoded = Buffer.from(raw).toString("utf16le");
  return decoded
    .split("\0")
    .map((value) => value.trim())
    .filter((value) => value.length >= 3);
}

function readHpsfString(
  raw: Uint8Array,
  sectionOffset: number,
  propertyOffset: number | undefined,
): string | null {
  if (propertyOffset === undefined) {
    return null;
  }

  const offset = sectionOffset + propertyOffset;
  if (offset + 8 > raw.length) {
    return null;
  }

  const type = MppUtility.getUInt(raw, offset);
  const length = MppUtility.getUInt(raw, offset + 4);
  if (length === 0) {
    return null;
  }

  if (type === 0x1e) {
    const value = MppUtility.getAnsiString(raw, offset + 8, length);
    return value.length > 0 ? value : null;
  }

  if (type === 0x1f) {
    const value = MppUtility.getUnicodeString(raw, offset + 8, length * 2);
    return value.length > 0 ? value : null;
  }

  return null;
}
