import { MppUtility } from "./MppUtility.ts";

export interface FixedMetaSummary {
  signature: number;
  version: number;
  itemCount: number;
  adjustedItemCount: number;
  itemSize: number;
  rawLength: number;
}

export class FixedMeta {
  constructor(
    public readonly raw: Uint8Array,
    public readonly summary: FixedMetaSummary,
    private readonly items: Uint8Array[],
  ) {}

  get itemCount(): number {
    return this.summary.itemCount;
  }

  get adjustedItemCount(): number {
    return this.summary.adjustedItemCount;
  }

  getByteArrayValue(index: number): Uint8Array | null {
    return this.items[index] ?? null;
  }

  static fromBuffer(raw: Uint8Array, itemSize: number): FixedMeta {
    return this.fromBufferWithProvider(raw, () => itemSize);
  }

  static fromBufferWithHeuristic(
    raw: Uint8Array,
    otherFixedDataItemCount: number,
    itemSizes: number[],
  ): FixedMeta {
    return this.fromBufferWithProvider(raw, (fileSize, itemCount) => {
      const available = fileSize - HEADER_SIZE;
      let chosenSize = itemSizes[0] ?? 0;
      let distance = Number.NEGATIVE_INFINITY;

      for (const candidate of itemSizes) {
        if (available % candidate !== 0) {
          continue;
        }

        if (available / candidate === otherFixedDataItemCount) {
          chosenSize = candidate;
          break;
        }

        const candidateDistance = itemCount * candidate - available;
        if (candidateDistance <= 0 && candidateDistance > distance) {
          chosenSize = candidate;
          distance = candidateDistance;
        }
      }

      return chosenSize;
    });
  }

  private static fromBufferWithProvider(
    raw: Uint8Array,
    itemSizeProvider: (fileSize: number, itemCount: number) => number,
  ): FixedMeta {
    const signature = raw.length >= 4 ? MppUtility.getUInt(raw, 0) : 0;
    const version = raw.length >= 8 ? MppUtility.getUInt(raw, 4) : 0;
    const itemCount = raw.length >= 12 ? MppUtility.getUInt(raw, 8) : 0;
    const itemSize = itemSizeProvider(raw.length, itemCount);
    const adjustedItemCount = itemSize > 0 ? Math.floor((raw.length - HEADER_SIZE) / itemSize) : 0;
    const items = Array.from({ length: adjustedItemCount }, (_, index) =>
      raw.subarray(HEADER_SIZE + index * itemSize, HEADER_SIZE + (index + 1) * itemSize),
    );

    return new FixedMeta(
      raw,
      {
        signature,
        version,
        itemCount,
        adjustedItemCount,
        itemSize,
        rawLength: raw.length,
      },
      items,
    );
  }
}

const HEADER_SIZE = 16;
