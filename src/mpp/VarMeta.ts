import { MppUtility } from "./MppUtility.ts";

export interface VarMetaSummary {
  signature: number;
  version: number;
  itemCount: number;
  dataSize: number;
  rawLength: number;
}

export class VarMeta {
  constructor(
    public readonly raw: Uint8Array,
    public readonly summary: VarMetaSummary,
    public readonly table: Map<number, Map<number, number>>,
    public readonly offsets: number[],
  ) {}

  get itemCount(): number {
    return this.summary.itemCount;
  }

  getOffset(id: number, type: number): number | null {
    return this.table.get(id)?.get(type) ?? null;
  }

  getTypes(id: number): Set<number> {
    return new Set(this.table.get(id)?.keys() ?? []);
  }

  static fromBuffer(raw: Uint8Array): VarMeta {
    const signature = raw.length >= 4 ? MppUtility.getUInt(raw, 0) : 0;
    const version = raw.length >= 8 ? MppUtility.getUInt(raw, 4) : 0;
    const itemCount = raw.length >= 12 ? MppUtility.getUInt(raw, 8) : 0;
    const dataSize = raw.length >= 24 ? MppUtility.getUInt(raw, 20) : 0;
    const table = new Map<number, Map<number, number>>();
    const offsets: number[] = [];

    for (
      let offset = 24, count = 0;
      offset + 12 <= raw.length && count < itemCount;
      offset += 12, count += 1
    ) {
      const uniqueId = MppUtility.getInt(raw, offset);
      const dataOffset = MppUtility.getInt(raw, offset + 4);
      const type = MppUtility.getUShort(raw, offset + 8);
      const entry = table.get(uniqueId) ?? new Map<number, number>();
      entry.set(type, dataOffset);
      table.set(uniqueId, entry);
      offsets.push(dataOffset);
    }

    offsets.sort((left, right) => left - right);

    return new VarMeta(
      raw,
      {
        signature,
        version,
        itemCount,
        dataSize,
        rawLength: raw.length,
      },
      table,
      offsets,
    );
  }
}
