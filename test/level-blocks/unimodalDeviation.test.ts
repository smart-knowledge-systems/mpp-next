import { test, expect, describe } from "bun:test";

import {
  UnimodalDeviationBlock,
  UnimodalDeviationInputSchema,
  unimodalDeviation,
} from "../../src/level-blocks/unimodalDeviation.ts";
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

describe("UnimodalDeviationBlock — input schema", () => {
  test("accepts valid params with defaults", () => {
    const parsed = UnimodalDeviationInputSchema.parse({ resourceUniqueId: 7 });
    expect(parsed.allowSecondPeak).toBe(false);
    expect(parsed.jitterTolerance).toBe(1);
  });

  test("respects explicit allowSecondPeak", () => {
    const parsed = UnimodalDeviationInputSchema.parse({
      resourceUniqueId: 7,
      allowSecondPeak: true,
    });
    expect(parsed.allowSecondPeak).toBe(true);
  });

  test("rejects negative jitterTolerance", () => {
    expect(() =>
      UnimodalDeviationInputSchema.parse({ resourceUniqueId: 7, jitterTolerance: -1 }),
    ).toThrow();
  });
});

describe("UnimodalDeviationBlock — unimodalDeviation", () => {
  test("perfect ramp returns zero", () => {
    expect(unimodalDeviation([1, 3, 5, 7, 5, 3, 1], false, 1)).toBe(0);
  });

  test("constant profile returns zero", () => {
    expect(unimodalDeviation([3, 3, 3, 3], false, 1)).toBe(0);
  });

  test("dip before peak adds magnitude beyond jitter", () => {
    // [1, 5, 2, 8] — peak at index 3; drop 5→2 of 3 (beyond jitter=1) = 2.
    expect(unimodalDeviation([1, 5, 2, 8], false, 1)).toBe(2);
  });

  test("bump after peak counts when allowSecondPeak=false", () => {
    // [1, 5, 8, 4, 2, 6] — peak 8 at index 2; descent then rise 2→6 of 4 (beyond jitter) = 3.
    expect(unimodalDeviation([1, 5, 8, 4, 2, 6], false, 1)).toBe(3);
  });

  test("first bump after peak is forgiven when allowSecondPeak=true", () => {
    expect(unimodalDeviation([1, 5, 8, 4, 2, 6], true, 1)).toBe(0);
  });

  test("second bump after peak still counts when allowSecondPeak=true", () => {
    // [1, 5, 8, 4, 6, 3, 5] — first bump 4→6 forgiven, drop 6→3, second bump 3→5 of 2 (beyond jitter) = 1.
    expect(unimodalDeviation([1, 5, 8, 4, 6, 3, 5], true, 1)).toBe(1);
  });

  test("jitter within tolerance does not count", () => {
    // Sub-jitter wobble around peak should be ignored.
    expect(unimodalDeviation([1, 4, 5, 4, 5, 3, 1], false, 1)).toBe(0);
  });
});

describe("UnimodalDeviationBlock — apply", () => {
  test("scores zero for unimodal profile", () => {
    // Mon Jan 5 → Mon Jan 19 is days 0..14. Place two tasks producing a peak.
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [
        { taskUniqueId: 1, units: 1 },
        { taskUniqueId: 2, units: 1 },
      ],
      scheduledTasks: [
        // Days 0-11 (W1+W2), 1 crew.
        { uniqueId: 1, startDay: 0, finishDay: 12, modeId: null },
        // Days 7-11 (W2), 1 crew, overlapping to lift peak to 2.
        { uniqueId: 2, startDay: 7, finishDay: 12, modeId: null },
      ],
    });
    const scorer = UnimodalDeviationBlock.apply({
      resourceUniqueId: 100,
      allowSecondPeak: false,
      jitterTolerance: 1,
    });
    expect(scorer.score(schedule)).toBe(0);
  });

  test("scores positive deviation for bimodal profile", () => {
    const schedule = makeSchedule({
      resourceUniqueId: 100,
      assignments: [
        { taskUniqueId: 1, units: 3 },
        { taskUniqueId: 2, units: 4 },
        { taskUniqueId: 3, units: 5 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null }, // W1, value 3
        { uniqueId: 2, startDay: 7, finishDay: 12, modeId: null }, // W2, value 4
        { uniqueId: 3, startDay: 21, finishDay: 26, modeId: null }, // W4, value 5
      ],
    });
    const scorer = UnimodalDeviationBlock.apply({
      resourceUniqueId: 100,
      allowSecondPeak: false,
      jitterTolerance: 1,
    });
    expect(scorer.score(schedule)).toBeGreaterThan(0);
  });

  test("scorer exposes the resource id in its name", () => {
    const scorer = UnimodalDeviationBlock.apply({
      resourceUniqueId: 42,
      allowSecondPeak: false,
      jitterTolerance: 1,
    });
    expect(scorer.name).toBe("UnimodalDeviation[r=42]");
    expect(scorer.direction).toBe("min");
  });
});

describe("UnimodalDeviationBlock — toMiniZinc", () => {
  test("emits weekly_demand references parameterized by resource id", () => {
    const fragment = UnimodalDeviationBlock.toMiniZinc({
      resourceUniqueId: 42,
      allowSecondPeak: false,
      jitterTolerance: 1,
    });
    expect(fragment.text).toContain("unimodal_deviation_42");
    expect(fragment.text).toContain("weekly_demand[42,w-1]");
    expect(fragment.text).toContain("peak_week[42]");
  });

  test("omits the post-peak rise term when allowSecondPeak", () => {
    const fragment = UnimodalDeviationBlock.toMiniZinc({
      resourceUniqueId: 7,
      allowSecondPeak: true,
      jitterTolerance: 1,
    });
    // The second sum's body collapses to 0 when allowSecondPeak.
    expect(fragment.text).toContain("( 0 )");
  });
});

describe("UnimodalDeviationBlock — metadata", () => {
  test("has stable id and non-empty doc", () => {
    expect(UnimodalDeviationBlock.id).toBe("UnimodalDeviation");
    expect(UnimodalDeviationBlock.doc.nl.length).toBeGreaterThan(0);
    expect(UnimodalDeviationBlock.doc.pseudocode.length).toBeGreaterThan(0);
  });
});
