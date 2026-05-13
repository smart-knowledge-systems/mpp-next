import { test, expect, describe } from "bun:test";

import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import {
  HiringLagPenaltyBlock,
  HiringLagPenaltyInputSchema,
  totalHires,
} from "../../src/level-blocks/hiringLagPenalty.ts";
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

// Build a Schedule with explicit ScheduledTask placements so we can pin
// the per-week resource profile under test.
function makeSchedule(opts: {
  scheduledTasks: ScheduledTask[];
  assignments: Array<{ taskUniqueId: number; units: number }>;
  resourceUniqueId: number;
}): Schedule {
  const calendars = [monFriCalendar()];
  const projectStart = new Date(2026, 0, 5); // Mon Jan 5 2026
  const project: ProjectFile = {
    properties: {
      title: null,
      author: null,
      startDate: projectStart,
      finishDate: null,
      statusDate: projectStart,
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
      start: projectStart,
      finish: projectStart,
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

describe("HiringLagPenaltyBlock — input schema", () => {
  test("accepts valid params", () => {
    const parsed = HiringLagPenaltyInputSchema.parse({
      resourceUniqueId: 7,
      trainingWeeks: 1,
      costPerCrewWeek: 5000,
    });
    expect(parsed.resourceUniqueId).toBe(7);
    expect(parsed.trainingWeeks).toBe(1);
    expect(parsed.costPerCrewWeek).toBe(5000);
  });

  test("rejects non-positive trainingWeeks", () => {
    expect(() =>
      HiringLagPenaltyInputSchema.parse({
        resourceUniqueId: 7,
        trainingWeeks: 0,
        costPerCrewWeek: 1,
      }),
    ).toThrow();
  });

  test("rejects negative costPerCrewWeek", () => {
    expect(() =>
      HiringLagPenaltyInputSchema.parse({
        resourceUniqueId: 7,
        trainingWeeks: 1,
        costPerCrewWeek: -1,
      }),
    ).toThrow();
  });
});

describe("HiringLagPenaltyBlock — totalHires", () => {
  test("empty profile yields zero hires", () => {
    expect(totalHires([])).toBe(0);
  });

  test("flat profile counts only the initial hire", () => {
    expect(totalHires([3, 3, 3, 3])).toBe(3);
  });

  test("each positive delta adds to hires", () => {
    // 2 initial + (+1) + (+2) = 5
    expect(totalHires([2, 3, 5, 5])).toBe(5);
  });

  test("layoffs are not counted (re-hires are)", () => {
    // 4 initial, drop to 1 (no credit), back to 4 (+3) = 7
    expect(totalHires([4, 1, 4])).toBe(7);
  });
});

describe("HiringLagPenaltyBlock — apply", () => {
  test("emits a min-direction Scorer", () => {
    const scorer = HiringLagPenaltyBlock.apply({
      resourceUniqueId: 100,
      trainingWeeks: 1,
      costPerCrewWeek: 1000,
    });
    expect(scorer.direction).toBe("min");
    expect(scorer.name).toContain("r=100");
  });

  test("penalty = initial hires × trainingWeeks × costPerCrewWeek for flat profile", () => {
    // 1 crew for one week → 1 hire × 1 × 1000 = 1000.
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [{ taskUniqueId: 1, units: 1 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 5, modeId: null }],
    });
    const scorer = HiringLagPenaltyBlock.apply({
      resourceUniqueId: 100,
      trainingWeeks: 1,
      costPerCrewWeek: 1000,
    });
    expect(scorer.score(schedule)).toBe(1000);
  });

  test("ramp-up across weeks compounds penalty", () => {
    // Profile [1, 2, 1] → hires = 1 + 1 + 0 = 2.  2 × 2 × 500 = 2000.
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [
        { taskUniqueId: 1, units: 1 },
        { taskUniqueId: 2, units: 1 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 12, modeId: null },
        { uniqueId: 2, startDay: 7, finishDay: 20, modeId: null },
      ],
    });
    const scorer = HiringLagPenaltyBlock.apply({
      resourceUniqueId: 100,
      trainingWeeks: 2,
      costPerCrewWeek: 500,
    });
    expect(scorer.score(schedule)).toBe(2000);
  });

  test("zero cost yields zero penalty regardless of profile", () => {
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [{ taskUniqueId: 1, units: 5 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 5, modeId: null }],
    });
    const scorer = HiringLagPenaltyBlock.apply({
      resourceUniqueId: 100,
      trainingWeeks: 4,
      costPerCrewWeek: 0,
    });
    expect(scorer.score(schedule)).toBe(0);
  });
});

describe("HiringLagPenaltyBlock — toMiniZinc", () => {
  test("emits an objective variable indexed by resource id", () => {
    const fragment = HiringLagPenaltyBlock.toMiniZinc({
      resourceUniqueId: 42,
      trainingWeeks: 1,
      costPerCrewWeek: 1000,
    });
    expect(fragment.text).toContain("hiring_lag_penalty_42");
    expect(fragment.text).toContain("weekly_demand[42,w]");
    expect(fragment.text).toContain("* 1 * 1000");
  });
});

describe("HiringLagPenaltyBlock — metadata", () => {
  test("has stable id and non-empty doc", () => {
    expect(HiringLagPenaltyBlock.id).toBe("HiringLagPenalty");
    expect(HiringLagPenaltyBlock.doc.nl.length).toBeGreaterThan(0);
    expect(HiringLagPenaltyBlock.doc.pseudocode.length).toBeGreaterThan(0);
  });
});
