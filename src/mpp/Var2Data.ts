import { MppUtility } from "./MppUtility.ts";
import type { VarMeta } from "./VarMeta.ts";

export class Var2Data {
  constructor(
    public readonly raw: Uint8Array,
    private readonly meta: VarMeta,
    private readonly blocks: Map<number, Uint8Array>,
  ) {}

  static fromMeta(meta: VarMeta, raw: Uint8Array): Var2Data {
    const blocks = new Map<number, Uint8Array>();

    for (const offset of meta.offsets) {
      if (offset < 0 || offset + 4 > raw.length) {
        continue;
      }

      const size = MppUtility.getInt(raw, offset);
      if (size < 0 || offset + 4 + size > raw.length) {
        continue;
      }

      blocks.set(offset, raw.subarray(offset + 4, offset + 4 + size));
    }

    return new Var2Data(raw, meta, blocks);
  }

  getByteArray(offset: number | null): Uint8Array | null {
    return offset === null ? null : (this.blocks.get(offset) ?? null);
  }

  getByteArrayById(id: number, type: number): Uint8Array | null {
    return this.getByteArray(this.meta.getOffset(id, type));
  }

  getUnicodeStringById(id: number, type: number): string | null {
    const value = this.getByteArrayById(id, type);
    if (!value) {
      return null;
    }
    const text = MppUtility.getUnicodeStringToEnd(value, 0);
    return text.length > 0 ? text : null;
  }
}
