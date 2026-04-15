import type { FixedMeta } from "./FixedMeta.ts";
import { MppUtility } from "./MppUtility.ts";

export class FixedData {
  private readonly offsetIndex: Map<number, number>;

  constructor(
    public readonly raw: Uint8Array,
    private readonly records: Array<Uint8Array | null>,
    private readonly offsets: number[],
  ) {
    this.offsetIndex = new Map<number, number>();
    for (let i = 0; i < offsets.length; i++) {
      if (!this.offsetIndex.has(offsets[i])) {
        this.offsetIndex.set(offsets[i], i);
      }
    }
  }

  get count(): number {
    return this.records.length;
  }

  getByteArrayValue(index: number): Uint8Array | null {
    return this.records[index] ?? null;
  }

  getIndexFromOffset(offset: number): number {
    return this.offsetIndex.get(offset) ?? -1;
  }

  static fromMeta(meta: FixedMeta, raw: Uint8Array, maxExpectedSize = 0, minSize = 0): FixedData {
    const records: Array<Uint8Array | null> = [];
    const offsets: number[] = [];

    for (let index = 0; index < meta.adjustedItemCount; index += 1) {
      const metaData = meta.getByteArrayValue(index);
      if (!metaData) {
        records.push(null);
        offsets.push(-1);
        continue;
      }

      const itemOffset = MppUtility.getInt(metaData, 4);
      offsets.push(itemOffset);
      if (itemOffset < 0 || itemOffset > raw.length) {
        records.push(null);
        continue;
      }

      let itemSize: number;
      if (index + 1 === meta.adjustedItemCount) {
        itemSize = raw.length - itemOffset;
      } else {
        const nextMetaData = meta.getByteArrayValue(index + 1);
        const nextOffset = nextMetaData ? MppUtility.getInt(nextMetaData, 4) : raw.length;
        itemSize = nextOffset - itemOffset;
      }

      if (itemSize === 0) {
        itemSize = minSize;
      }

      const available = raw.length - itemOffset;
      if (itemSize < 0 || itemSize > available) {
        itemSize = maxExpectedSize === 0 ? available : Math.min(maxExpectedSize, available);
      }

      if (maxExpectedSize !== 0 && itemSize > maxExpectedSize) {
        itemSize = maxExpectedSize;
      }

      records.push(itemSize > 0 ? raw.subarray(itemOffset, itemOffset + itemSize) : null);
    }

    return new FixedData(raw, records, offsets);
  }

  static fromFixedSize(raw: Uint8Array, itemSize: number, readRemainderBlock = false): FixedData {
    const count =
      Math.floor(raw.length / itemSize) +
      (readRemainderBlock && raw.length % itemSize !== 0 ? 1 : 0);
    const records: Array<Uint8Array | null> = [];
    const offsets: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const start = index * itemSize;
      const end = Math.min(raw.length, start + itemSize);
      records.push(raw.subarray(start, end));
      offsets.push(start);
    }

    return new FixedData(raw, records, offsets);
  }
}
