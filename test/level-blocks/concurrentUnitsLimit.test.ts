import { test, expect, describe } from "bun:test";

import {
  ConcurrentUnitsLimitBlock,
  ConcurrentUnitsLimitInputSchema,
} from "../../src/level-blocks/concurrentUnitsLimit.ts";

const unitIds = [10, 20];

describe("ConcurrentUnitsLimitBlock — input schema", () => {
  test("accepts whole-bay params (no discipline)", () => {
    const parsed = ConcurrentUnitsLimitInputSchema.parse({ unitIds, max: 3 });
    expect(parsed.discipline).toBeUndefined();
    expect(parsed.max).toBe(3);
    expect(parsed.unitIds).toEqual([10, 20]);
  });

  test("accepts a discipline-scoped cap", () => {
    const parsed = ConcurrentUnitsLimitInputSchema.parse({ unitIds, discipline: 200, max: 2 });
    expect(parsed.discipline).toBe(200);
  });

  test("rejects zero max", () => {
    expect(() => ConcurrentUnitsLimitInputSchema.parse({ unitIds, max: 0 })).toThrow();
  });

  test("rejects non-integer max", () => {
    expect(() => ConcurrentUnitsLimitInputSchema.parse({ unitIds, max: 1.5 })).toThrow();
  });
});

describe("ConcurrentUnitsLimitBlock — apply", () => {
  test("emits a whole-bay ConcurrentUnitsLimit constraint", () => {
    const c = ConcurrentUnitsLimitBlock.apply({ unitIds, max: 3 });
    if (c.kind !== "ConcurrentUnitsLimit") throw new Error("wrong constraint kind");
    expect(c.max).toBe(3);
    expect(c.discipline).toBeUndefined();
    expect(c.unitIds).toEqual(unitIds);
  });

  test("carries the discipline through when set", () => {
    const c = ConcurrentUnitsLimitBlock.apply({ unitIds, discipline: 200, max: 2 });
    if (c.kind !== "ConcurrentUnitsLimit") throw new Error("wrong constraint kind");
    expect(c.discipline).toBe(200);
  });

  test("output passes the output schema", () => {
    const out = ConcurrentUnitsLimitBlock.apply({ unitIds, discipline: 200, max: 2 });
    expect(() => ConcurrentUnitsLimitBlock.schema.output.parse(out)).not.toThrow();
  });
});

describe("ConcurrentUnitsLimitBlock — toMiniZinc", () => {
  test("caps the per-day count of open units over the unit set", () => {
    const fragment = ConcurrentUnitsLimitBlock.toMiniZinc({ unitIds, max: 2 });
    expect(fragment.text).toBe(
      "constraint forall(d in DAYS) ( sum(u in {10,20}) (bool2int(unit_open[u,d])) <= 2 );",
    );
  });
});

describe("ConcurrentUnitsLimitBlock — metadata", () => {
  test("has stable id and non-empty doc", () => {
    expect(ConcurrentUnitsLimitBlock.id).toBe("ConcurrentUnitsLimit");
    expect(ConcurrentUnitsLimitBlock.doc.nl.length).toBeGreaterThan(0);
    expect(ConcurrentUnitsLimitBlock.doc.pseudocode.length).toBeGreaterThan(0);
  });
});
