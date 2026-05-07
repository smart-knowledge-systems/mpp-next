import { test, expect, describe } from "bun:test";

import { ScheduleStreamImpl, streamFromFactory } from "../../src/level-core/scheduleStream.ts";
import type {
  ResolvedProject,
  Schedule,
  ScheduledTask,
  Scorer,
} from "../../src/level-core/types.ts";

const fakeResolved = {
  source: { tasks: [] } as unknown,
  defaultCalendarUniqueId: null,
  calendars: new Map(),
  tasks: [],
  resources: [],
  assignments: [],
  precedences: [],
} as unknown as ResolvedProject;

function fakeSchedule(makespan: number, peak = 0): Schedule {
  const tasks: ScheduledTask[] = [{ uniqueId: 1, startDay: 0, finishDay: makespan, modeId: null }];
  // Stash peak in modeId of a fake second task purely for scoring tests.
  tasks.push({ uniqueId: 99, startDay: 0, finishDay: peak, modeId: null });
  return { resolved: fakeResolved, tasks, makespan, annotations: new Map() };
}

const makespanScorer: Scorer = {
  name: "makespan",
  direction: "min",
  score: (s) => s.tasks[0]!.finishDay,
};

const peakScorer: Scorer = {
  name: "peak",
  direction: "min",
  score: (s) => s.tasks[1]!.finishDay,
};

function streamOf(...schedules: Schedule[]) {
  return streamFromFactory(async function* () {
    for (const s of schedules) yield s;
  });
}

describe("ScheduleStream — lazy transforms", () => {
  test("filter keeps only matching schedules", async () => {
    const out = await streamOf(fakeSchedule(3), fakeSchedule(5), fakeSchedule(7))
      .filter((s) => s.tasks[0]!.finishDay > 4)
      .collect();
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.tasks[0]!.finishDay)).toEqual([5, 7]);
  });

  test("map transforms each schedule", async () => {
    const out = await streamOf(fakeSchedule(3))
      .map((s) => ({ ...s, annotations: new Map() }))
      .collect();
    expect(out).toHaveLength(1);
  });

  test("take(k) only pulls the first k", async () => {
    let pulled = 0;
    const stream = streamFromFactory(async function* () {
      while (true) {
        pulled++;
        yield fakeSchedule(pulled);
      }
    });
    const out = await stream.take(3).collect();
    expect(out).toHaveLength(3);
    expect(pulled).toBe(3);
  });

  test("take(0) is empty and never pulls", async () => {
    let pulled = 0;
    const stream = streamFromFactory(async function* () {
      pulled++;
      yield fakeSchedule(1);
    });
    const out = await stream.take(0).collect();
    expect(out).toEqual([]);
    expect(pulled).toBe(0);
  });

  test("branch composes — each input fans out into the sub-stream", async () => {
    const out = await streamOf(fakeSchedule(3), fakeSchedule(5))
      .branch((s) =>
        streamOf(s, { ...s, tasks: [{ ...s.tasks[0]!, finishDay: s.tasks[0]!.finishDay + 1 }] }),
      )
      .collect();
    expect(out).toHaveLength(4);
    expect(out.map((s) => s.tasks[0]!.finishDay)).toEqual([3, 4, 5, 6]);
  });
});

describe("ScheduleStream — materializing operations", () => {
  test("bestBy returns the min-scoring schedule", async () => {
    const stream = streamOf(fakeSchedule(7), fakeSchedule(3), fakeSchedule(5));
    const best = await stream.bestBy(makespanScorer);
    expect(best?.tasks[0]!.finishDay).toBe(3);
  });

  test("bestBy with direction=max returns the max-scoring schedule", async () => {
    const stream = streamOf(fakeSchedule(7), fakeSchedule(3), fakeSchedule(5));
    const best = await stream.bestBy({ ...makespanScorer, direction: "max" });
    expect(best?.tasks[0]!.finishDay).toBe(7);
  });

  test("bestBy on empty stream returns null", async () => {
    expect(await streamOf().bestBy(makespanScorer)).toBeNull();
  });

  test("collect with limit stops early", async () => {
    const out = await streamOf(fakeSchedule(1), fakeSchedule(2), fakeSchedule(3)).collect(2);
    expect(out).toHaveLength(2);
  });

  test("paretoFrontier excludes dominated schedules", async () => {
    // (makespan, peak): (5, 2) dominates (5, 3) and (6, 3); (3, 5) is non-dominated.
    const a = fakeSchedule(5, 2);
    const b = fakeSchedule(5, 3);
    const c = fakeSchedule(6, 3);
    const d = fakeSchedule(3, 5);
    const frontier = await streamOf(a, b, c, d).paretoFrontier([makespanScorer, peakScorer]);
    expect(frontier).toHaveLength(2);
    expect(frontier).toContain(a);
    expect(frontier).toContain(d);
  });
});

describe("ScheduleStream — reusability", () => {
  test("calling Symbol.asyncIterator twice gives independent runs", async () => {
    const stream = streamOf(fakeSchedule(1), fakeSchedule(2));
    const first: number[] = [];
    for await (const s of stream) first.push(s.tasks[0]!.finishDay);
    const second: number[] = [];
    for await (const s of stream) second.push(s.tasks[0]!.finishDay);
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([1, 2]);
  });

  test("ScheduleStreamImpl is the implementation type", () => {
    const stream = streamOf(fakeSchedule(1));
    expect(stream).toBeInstanceOf(ScheduleStreamImpl);
  });
});
