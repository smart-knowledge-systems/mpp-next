import { test, expect, describe } from "bun:test";

import {
  OpenUnitPenaltyBlock,
  OpenUnitPenaltyInputSchema,
} from "../../src/level-blocks/openUnitPenalty.ts";
import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import { ResourceType } from "../../src/model/types.ts";
import type { Schedule, ScheduledTask, WorkUnit } from "../../src/level-core/types.ts";
import type { Calendar } from "../../src/schema/calendar.ts";
import type { ProjectFile } from "../../src/schema/project.ts";

function monFriCalendar(uniqueId = 1): Calendar {
  return {
    uniqueId,
    name: "Standard",
    weekDays: [
      { dayType: 1, working: false, workingTimes: [] },
      { dayType: 2, working: true, workingTimes: [] },
      { dayType: 3, working: true, workingTimes: [] },
      { dayType: 4, working: true, workingTimes: [] },
      { dayType: 5, working: true, workingTimes: [] },
      { dayType: 6, working: true, workingTimes: [] },
      { dayType: 7, working: false, workingTimes: [] },
    ],
    exceptions: [],
  };
}

function makeSchedule(opts: {
  scheduledTasks: ScheduledTask[];
  resourceUniqueIds: number[];
  assignments: Array<{ taskUniqueId: number; resourceUniqueId: number }>;
  workUnits?: WorkUnit[];
}): Schedule {
  const calendars = [monFriCalendar()];
  const epoch = new Date(2026, 0, 5); // Mon Jan 5
  const project: ProjectFile = {
    properties: {
      title: null,
      author: null,
      startDate: epoch,
      finishDate: null,
      statusDate: epoch,
      defaultCalendarUniqueId: calendars[0]!.uniqueId,
      minutesPerDay: 480,
      minutesPerWeek: 2400,
      daysPerMonth: 20,
      saveVersion: null,
    },
    tasks: opts.scheduledTasks.map((s) => ({
      id: null,
      uniqueId: s.uniqueId,
      name: `Task ${String(s.uniqueId)}`,
      wbs: null,
      outlineLevel: 0,
      start: epoch,
      finish: epoch,
      duration: null,
      percentComplete: null,
      summary: false,
      milestone: false,
      critical: null,
      notes: null,
      priority: null,
      cost: null,
      work: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      baselineDuration: null,
      actualWork: null,
      constraintType: null,
      freeSlack: null,
      totalSlack: null,
      earlyStart: null,
      earlyFinish: null,
      lateStart: null,
      lateFinish: null,
      levelingDelay: null,
      deadline: null,
      splits: null,
      predecessors: [],
    })),
    resources: opts.resourceUniqueIds.map((uniqueId, i) => ({
      id: i + 1,
      uniqueId,
      name: `Resource ${String(uniqueId)}`,
      type: ResourceType.Work,
      email: null,
      group: null,
      maxUnits: null,
      cost: null,
      work: null,
      resourcePool: null,
    })),
    assignments: opts.assignments.map((a) => ({
      taskUniqueId: a.taskUniqueId,
      resourceUniqueId: a.resourceUniqueId,
      work: null,
      units: 1,
      start: null,
      finish: null,
      actualWork: null,
      remainingWork: null,
    })),
    calendars,
  };
  const resolved = resolveCalendar(project, { workUnits: opts.workUnits });
  const makespan = opts.scheduledTasks.reduce((m, t) => Math.max(m, t.finishDay), 0);
  return { resolved, tasks: opts.scheduledTasks, makespan, annotations: new Map() };
}

describe("OpenUnitPenaltyBlock — input schema", () => {
  test("defaults softMax=0 and weight=1", () => {
    const parsed = OpenUnitPenaltyInputSchema.parse({ unitIds: [1] });
    expect(parsed.softMax).toBe(0);
    expect(parsed.weight).toBe(1);
  });

  test("rejects negative softMax", () => {
    expect(() => OpenUnitPenaltyInputSchema.parse({ unitIds: [], softMax: -1 })).toThrow();
  });

  test("rejects non-positive weight", () => {
    expect(() => OpenUnitPenaltyInputSchema.parse({ unitIds: [], weight: 0 })).toThrow();
  });
});

describe("OpenUnitPenaltyBlock — apply (whole-bay)", () => {
  test("prices each open-unit-day beyond softMax", () => {
    // Two units, each one task, both open working days 0-4 (5 days).
    // openCount = 2 each day; softMax=1 → over=1/day × 5 days × weight 1 = 5.
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 100 },
        { taskUniqueId: 2, resourceUniqueId: 100 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
      workUnits: [
        { id: 10, taskUniqueIds: [1] },
        { id: 20, taskUniqueIds: [2] },
      ],
    });
    const scorer = OpenUnitPenaltyBlock.apply({ unitIds: [10, 20], softMax: 1, weight: 1 });
    expect(scorer.score(schedule)).toBe(5);
  });

  test("softMax that covers all open units yields zero", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 100 },
        { taskUniqueId: 2, resourceUniqueId: 100 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
      workUnits: [
        { id: 10, taskUniqueIds: [1] },
        { id: 20, taskUniqueIds: [2] },
      ],
    });
    const scorer = OpenUnitPenaltyBlock.apply({ unitIds: [10, 20], softMax: 2, weight: 1 });
    expect(scorer.score(schedule)).toBe(0);
  });

  test("a unit stays open across idle gaps between its tasks", () => {
    // One unit with two tasks: task1 active day 0 (start0,finish1), task2 active
    // day 3 (start3,finish4). The unit's open span is [0,4): working days
    // 0,1,2,3 — including the idle gap on days 1-2. softMax=0,weight=1 → 4.
    // (Active-day occupancy would have charged only 2.)
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 100 },
        { taskUniqueId: 2, resourceUniqueId: 100 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 1, modeId: null },
        { uniqueId: 2, startDay: 3, finishDay: 4, modeId: null },
      ],
      workUnits: [{ id: 10, taskUniqueIds: [1, 2] }],
    });
    const scorer = OpenUnitPenaltyBlock.apply({ unitIds: [10], softMax: 0, weight: 1 });
    expect(scorer.score(schedule)).toBe(4);
  });

  test("weight scales the penalty", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [{ taskUniqueId: 1, resourceUniqueId: 100 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 5, modeId: null }],
      workUnits: [{ id: 10, taskUniqueIds: [1] }],
    });
    const scorer = OpenUnitPenaltyBlock.apply({ unitIds: [10], softMax: 0, weight: 10 });
    // 5 working days open × 10 = 50.
    expect(scorer.score(schedule)).toBe(50);
  });

  test("a duplicate unit reference counts the unit once (set semantics)", () => {
    // unitIds:[10,10] must score the same as [10] — matches MiniZinc's `{10,10}`
    // set collapse and prevents JS/MiniZinc objective divergence.
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [{ taskUniqueId: 1, resourceUniqueId: 100 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 5, modeId: null }],
      workUnits: [{ id: 10, taskUniqueIds: [1] }],
    });
    const once = OpenUnitPenaltyBlock.apply({ unitIds: [10], softMax: 0, weight: 1 });
    const twice = OpenUnitPenaltyBlock.apply({ unitIds: [10, 10], softMax: 0, weight: 1 });
    expect(twice.score(schedule)).toBe(once.score(schedule));
    expect(twice.score(schedule)).toBe(5);
  });
});

describe("OpenUnitPenaltyBlock — apply (discipline-scoped)", () => {
  test("open span is computed only over the discipline's tasks", () => {
    // Unit 10: electrical task1 (res 200) on day 0 only; general task2 (res 100)
    // spanning days 0-4. Whole-bay span would be 5 days, but discipline 200
    // sees only task1 → open span [0,1) → 1 working day × weight 1 = 1.
    const schedule = makeSchedule({
      resourceUniqueIds: [100, 200],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 200 },
        { taskUniqueId: 2, resourceUniqueId: 100 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 1, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
      workUnits: [{ id: 10, taskUniqueIds: [1, 2] }],
    });
    const scorer = OpenUnitPenaltyBlock.apply({
      unitIds: [10],
      discipline: 200,
      softMax: 0,
      weight: 1,
    });
    expect(scorer.score(schedule)).toBe(1);
  });
});

describe("OpenUnitPenaltyBlock — toMiniZinc", () => {
  test("emits a per-day soft penalty over the open-span matrix", () => {
    const fragment = OpenUnitPenaltyBlock.toMiniZinc({ unitIds: [10, 20], softMax: 1, weight: 2 });
    expect(fragment.text).toContain("open_unit_penalty");
    expect(fragment.text).toContain("unit_open_span[u,d]");
    expect(fragment.text).toContain("sum(u in {10,20})");
    expect(fragment.text).toContain("- 1)");
  });
});

describe("OpenUnitPenaltyBlock — metadata", () => {
  test("has stable id, min direction, and non-empty doc", () => {
    expect(OpenUnitPenaltyBlock.id).toBe("OpenUnitPenalty");
    expect(OpenUnitPenaltyBlock.apply({ unitIds: [], softMax: 0, weight: 1 }).direction).toBe(
      "min",
    );
    expect(OpenUnitPenaltyBlock.doc.nl.length).toBeGreaterThan(0);
    expect(OpenUnitPenaltyBlock.doc.pseudocode.length).toBeGreaterThan(0);
  });
});
