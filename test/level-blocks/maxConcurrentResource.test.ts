import { test, expect, describe } from "bun:test";

import {
  MaxConcurrentResourceBlock,
  MaxConcurrentResourceInputSchema,
} from "../../src/level-blocks/maxConcurrentResource.ts";

describe("MaxConcurrentResourceBlock — input schema", () => {
  test("accepts valid params", () => {
    const parsed = MaxConcurrentResourceInputSchema.parse({ resourceUniqueId: 7, max: 3 });
    expect(parsed).toEqual({ resourceUniqueId: 7, max: 3 });
  });

  test("rejects non-numeric resourceUniqueId", () => {
    expect(() =>
      MaxConcurrentResourceInputSchema.parse({ resourceUniqueId: "7", max: 3 }),
    ).toThrow();
  });

  test("rejects zero max", () => {
    expect(() => MaxConcurrentResourceInputSchema.parse({ resourceUniqueId: 7, max: 0 })).toThrow();
  });

  test("rejects non-integer max", () => {
    expect(() =>
      MaxConcurrentResourceInputSchema.parse({ resourceUniqueId: 7, max: 1.5 }),
    ).toThrow();
  });
});

describe("MaxConcurrentResourceBlock — apply", () => {
  test("emits a MaxConcurrentResource constraint variant", () => {
    const constraint = MaxConcurrentResourceBlock.apply({ resourceUniqueId: 42, max: 2 });
    expect(constraint).toEqual({ kind: "MaxConcurrentResource", resourceUniqueId: 42, max: 2 });
  });

  test("output passes the output schema", () => {
    const out = MaxConcurrentResourceBlock.apply({ resourceUniqueId: 1, max: 3 });
    expect(() => MaxConcurrentResourceBlock.schema.output.parse(out)).not.toThrow();
  });
});

describe("MaxConcurrentResourceBlock — toMiniZinc", () => {
  test("emits a constraint over the resource's task set", () => {
    const fragment = MaxConcurrentResourceBlock.toMiniZinc({ resourceUniqueId: 42, max: 2 });
    expect(fragment.text).toBe(
      "constraint forall(d in DAYS) ( sum(t in tasks_demanding[42]) (bool2int(active[t,d])) <= 2 );",
    );
  });

  test("scales with the configured cap", () => {
    const fragment = MaxConcurrentResourceBlock.toMiniZinc({ resourceUniqueId: 5, max: 99 });
    expect(fragment.text).toContain("<= 99");
    expect(fragment.text).toContain("tasks_demanding[5]");
  });
});

describe("MaxConcurrentResourceBlock — metadata", () => {
  test("has stable id and non-empty doc", () => {
    expect(MaxConcurrentResourceBlock.id).toBe("MaxConcurrentResource");
    expect(MaxConcurrentResourceBlock.doc.nl.length).toBeGreaterThan(0);
    expect(MaxConcurrentResourceBlock.doc.pseudocode.length).toBeGreaterThan(0);
  });
});
