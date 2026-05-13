import { test, expect, describe } from "bun:test";

import {
  ConcurrentResourceCostBlock,
  ConcurrentResourceCostInputSchema,
  dayCost,
} from "../../src/level-blocks/concurrentResourceCost.ts";
import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import { ResourceType } from "../../src/model/types.ts";
import type { Schedule, ScheduledTask } from "../../src/level-core/types.ts";
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
  assignments: Array<{ taskUniqueId: number; units: number }>;
  resourceUniqueId: number;
}): Schedule {
  const calendars = [monFriCalendar()];
  const epoch = new Date(2026, 0, 5);
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
    resources: [
      {
        id: 1,
        uniqueId: opts.resourceUniqueId,
        name: "Crew",
        type: ResourceType.Work,
        email: null,
        group: null,
        maxUnits: null,
        cost: null,
        work: null,
        resourcePool: null,
      },
    ],
    assignments: opts.assignments.map((a) => ({
      taskUniqueId: a.taskUniqueId,
      resourceUniqueId: opts.resourceUniqueId,
      work: null,
      units: a.units,
      start: null,
      finish: null,
      actualWork: null,
      remainingWork: null,
    })),
    calendars,
  };
  const resolved = resolveCalendar(project);
  const makespan = opts.scheduledTasks.reduce((m, t) => Math.max(m, t.finishDay), 0);
  return {
    resolved,
    tasks: opts.scheduledTasks,
    makespan,
    annotations: new Map(),
  };
}

describe("ConcurrentResourceCostBlock — input schema", () => {
  test("accepts valid params with default threshold", () => {
    const parsed = ConcurrentResourceCostInputSchema.parse({
      resourceUniqueId: 7,
      basePrice: 100,
      growthBase: 2,
    });
    expect(parsed.threshold).toBe(0);
    expect(parsed.growthBase).toBe(2);
  });

  test("rejects growthBase ≤ 1", () => {
    expect(() =>
      ConcurrentResourceCostInputSchema.parse({
        resourceUniqueId: 7,
        basePrice: 100,
        growthBase: 1,
      }),
    ).toThrow();
  });

  test("rejects non-positive basePrice", () => {
    expect(() =>
      ConcurrentResourceCostInputSchema.parse({
        resourceUniqueId: 7,
        basePrice: 0,
        growthBase: 2,
      }),
    ).toThrow();
  });
});

describe("ConcurrentResourceCostBlock — dayCost", () => {
  test("returns 0 at or below threshold", () => {
    expect(dayCost(0, 100, 2, 1)).toBe(0);
    expect(dayCost(1, 100, 2, 1)).toBe(0);
  });

  test("growthBase=2 doubles marginal cost per worker", () => {
    // basePrice=100, growthBase=2, threshold=0:
    //   load=1 → 100*(2-1)=100, load=2 → 100*(4-1)=300, load=3 → 100*(8-1)=700.
    expect(dayCost(1, 100, 2, 0)).toBe(100);
    expect(dayCost(2, 100, 2, 0)).toBe(300);
    expect(dayCost(3, 100, 2, 0)).toBe(700);
  });

  test("threshold shifts the cost curve right", () => {
    // basePrice=100, growthBase=2, threshold=2:
    //   load=2 → 0, load=3 → 100*(2-1)=100, load=4 → 100*(4-1)=300.
    expect(dayCost(2, 100, 2, 2)).toBe(0);
    expect(dayCost(3, 100, 2, 2)).toBe(100);
    expect(dayCost(4, 100, 2, 2)).toBe(300);
  });
});

describe("ConcurrentResourceCostBlock — apply", () => {
  test("zero cost when no demand", () => {
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [],
      scheduledTasks: [],
    });
    const scorer = ConcurrentResourceCostBlock.apply({
      resourceUniqueId: 100,
      basePrice: 100,
      growthBase: 2,
      threshold: 0,
    });
    expect(scorer.score(schedule)).toBe(0);
  });

  test("single-crew workload accrues linear basePrice per working day", () => {
    // 5 working days, load=1 each → 5 × 100 × (2-1) = 500.
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [{ taskUniqueId: 1, units: 1 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 7, modeId: null }],
    });
    const scorer = ConcurrentResourceCostBlock.apply({
      resourceUniqueId: 100,
      basePrice: 100,
      growthBase: 2,
      threshold: 0,
    });
    expect(scorer.score(schedule)).toBe(500);
  });

  test("overlapping tasks compound by load, not by task count", () => {
    // Both tasks days 0-4, units 1 each → daily load=2. 5 days × 100 × (4-1) = 1500.
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [
        { taskUniqueId: 1, units: 1 },
        { taskUniqueId: 2, units: 1 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
    });
    const scorer = ConcurrentResourceCostBlock.apply({
      resourceUniqueId: 100,
      basePrice: 100,
      growthBase: 2,
      threshold: 0,
    });
    expect(scorer.score(schedule)).toBe(1500);
  });

  test("threshold makes the first N workers free", () => {
    // load=2 days 0-4, threshold=1 → effective load excess = 1 per day, 5 days × 100×1 = 500.
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [
        { taskUniqueId: 1, units: 1 },
        { taskUniqueId: 2, units: 1 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
    });
    const scorer = ConcurrentResourceCostBlock.apply({
      resourceUniqueId: 100,
      basePrice: 100,
      growthBase: 2,
      threshold: 1,
    });
    expect(scorer.score(schedule)).toBe(500);
  });

  test("non-working days do not accrue cost", () => {
    // Task spans Sat+Sun within its 7-day extent — only working days bill.
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [{ taskUniqueId: 1, units: 1 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 7, modeId: null }],
    });
    const scorer = ConcurrentResourceCostBlock.apply({
      resourceUniqueId: 100,
      basePrice: 100,
      growthBase: 2,
      threshold: 0,
    });
    // 5 working days × 100 = 500 (Sat day 5 and Sun day 6 are not billed).
    expect(scorer.score(schedule)).toBe(500);
  });

  test("super-linear shape — going from 2 to 3 costs more than 0 to 2", () => {
    const sched2 = makeSchedule({
      resourceUniqueId: 100,
      assignments: [
        { taskUniqueId: 1, units: 1 },
        { taskUniqueId: 2, units: 1 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
    });
    const sched3 = makeSchedule({
      resourceUniqueId: 100,
      assignments: [
        { taskUniqueId: 1, units: 1 },
        { taskUniqueId: 2, units: 1 },
        { taskUniqueId: 3, units: 1 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 3, startDay: 0, finishDay: 5, modeId: null },
      ],
    });
    const scorer = ConcurrentResourceCostBlock.apply({
      resourceUniqueId: 100,
      basePrice: 100,
      growthBase: 2,
      threshold: 0,
    });
    const cost2 = scorer.score(sched2);
    const cost3 = scorer.score(sched3);
    // load=2 cost = 100*3 = 300 per day; load=3 cost = 100*7 = 700 per day.
    // Marginal cost of the 3rd worker (700-300=400) exceeds adding 2nd (300-100=200).
    expect(cost3 - cost2).toBeGreaterThan(cost2 - 500); // 500 = baseline 1-worker cost
  });
});

describe("ConcurrentResourceCostBlock — toMiniZinc", () => {
  test("emits a per-day exponential cost expression", () => {
    const fragment = ConcurrentResourceCostBlock.toMiniZinc({
      resourceUniqueId: 42,
      basePrice: 100,
      growthBase: 2,
      threshold: 1,
    });
    expect(fragment.text).toContain("concurrent_resource_cost_42");
    expect(fragment.text).toContain("tasks_demanding[42]");
    expect(fragment.text).toContain("pow(2, load - 1)");
  });
});

describe("ConcurrentResourceCostBlock — metadata", () => {
  test("has stable id and non-empty doc", () => {
    expect(ConcurrentResourceCostBlock.id).toBe("ConcurrentResourceCost");
    expect(ConcurrentResourceCostBlock.doc.nl.length).toBeGreaterThan(0);
    expect(ConcurrentResourceCostBlock.doc.pseudocode.length).toBeGreaterThan(0);
  });
});
