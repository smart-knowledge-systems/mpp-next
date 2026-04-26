import { test, expect, describe } from "bun:test";

import {
  MaxConcurrentResourceBlock,
  MaxConcurrentResourceSchema,
} from "../../src/level-core/blocks/maxConcurrentResource.ts";
import type { MiniZincContext, ResolvedProject } from "../../src/level-core/types.ts";

const fakeResolved = {
  source: { tasks: [] } as unknown,
  calendar: { origin: new Date(0), bitmap: [], calendarUniqueId: null },
  tasks: [],
  assignments: [],
  precedences: [],
} as unknown as ResolvedProject;

describe("MaxConcurrentResourceBlock — schema", () => {
  test("accepts valid params", () => {
    const parsed = MaxConcurrentResourceSchema.parse({ resourceUniqueId: 7, max: 3 });
    expect(parsed).toEqual({ resourceUniqueId: 7, max: 3 });
  });

  test("rejects non-numeric resourceUniqueId", () => {
    expect(() => MaxConcurrentResourceSchema.parse({ resourceUniqueId: "7", max: 3 })).toThrow();
  });

  test("rejects zero max", () => {
    expect(() => MaxConcurrentResourceSchema.parse({ resourceUniqueId: 7, max: 0 })).toThrow();
  });

  test("rejects negative max", () => {
    expect(() => MaxConcurrentResourceSchema.parse({ resourceUniqueId: 7, max: -1 })).toThrow();
  });

  test("rejects non-integer max", () => {
    expect(() => MaxConcurrentResourceSchema.parse({ resourceUniqueId: 7, max: 1.5 })).toThrow();
  });
});

describe("MaxConcurrentResourceBlock — apply", () => {
  test("produces a MaxConcurrentResource constraint", () => {
    const constraints = MaxConcurrentResourceBlock.apply(fakeResolved, {
      resourceUniqueId: 42,
      max: 2,
    });
    expect(constraints).toEqual([{ kind: "MaxConcurrentResource", resourceUniqueId: 42, max: 2 }]);
  });
});

describe("MaxConcurrentResourceBlock — toMiniZinc", () => {
  const ctx: MiniZincContext = {
    tasksDemanding: (resourceUniqueId) => (resourceUniqueId === 42 ? [10, 11, 12] : []),
  };

  test("emits constraint with task set and max", () => {
    const out = MaxConcurrentResourceBlock.toMiniZinc({ resourceUniqueId: 42, max: 2 }, ctx);
    expect(out).toBe(
      "constraint forall(d in DAYS) ( sum(t in {10,11,12}) (bool2int(active[t,d])) <= 2 );",
    );
  });

  test("emits empty task set when no tasks demand the resource", () => {
    const out = MaxConcurrentResourceBlock.toMiniZinc({ resourceUniqueId: 99, max: 1 }, ctx);
    expect(out).toBe("constraint forall(d in DAYS) ( sum(t in {}) (bool2int(active[t,d])) <= 1 );");
  });
});

describe("MaxConcurrentResourceBlock — metadata", () => {
  test("has expected name and non-empty doc", () => {
    expect(MaxConcurrentResourceBlock.name).toBe("MaxConcurrentResource");
    expect(MaxConcurrentResourceBlock.doc.length).toBeGreaterThan(0);
  });
});
