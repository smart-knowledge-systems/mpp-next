import { test, expect, describe } from "bun:test";

import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import {
  buildResourceLoad,
  combinedPeakLoad,
  peakLoad,
  scheduleSpan,
  snapToSunday,
  weeklyProfile,
  weeklyProfileCombined,
} from "../../src/level-core/weeklyProfile.ts";
import { ResourceType } from "../../src/model/types.ts";
import type { Schedule, ScheduledTask } from "../../src/level-core/types.ts";
import type { Calendar } from "../../src/schema/calendar.ts";
import type { ProjectFile } from "../../src/schema/project.ts";

function monFriCalendar(uniqueId = 1): Calendar {
  return {
    uniqueId,
    name: "Standard",
    weekDays: [
      { dayType: 1, working: false, workingTimes: [] }, // Sun
      { dayType: 2, working: true, workingTimes: [] }, // Mon
      { dayType: 3, working: true, workingTimes: [] }, // Tue
      { dayType: 4, working: true, workingTimes: [] }, // Wed
      { dayType: 5, working: true, workingTimes: [] }, // Thu
      { dayType: 6, working: true, workingTimes: [] }, // Fri
      { dayType: 7, working: false, workingTimes: [] }, // Sat
    ],
    exceptions: [],
  };
}

function makeSchedule(opts: {
  scheduledTasks: ScheduledTask[];
  assignments: Array<{ taskUniqueId: number; resourceUniqueId: number; units: number }>;
  resourceUniqueIds: ReadonlyArray<number>;
  epoch?: Date;
}): Schedule {
  const calendars = [monFriCalendar()];
  const epoch = opts.epoch ?? new Date(2026, 0, 5); // Mon Jan 5 2026
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
    resources: opts.resourceUniqueIds.map((uniqueId) => ({
      id: uniqueId,
      uniqueId,
      name: `R${String(uniqueId)}`,
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

describe("weeklyProfile — buildResourceLoad", () => {
  test("two tasks on disjoint days accumulate per-day demand", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 100, units: 2 },
        { taskUniqueId: 2, resourceUniqueId: 100, units: 1 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 3, modeId: null }, // Mon-Wed = 2 each
        { uniqueId: 2, startDay: 3, finishDay: 5, modeId: null }, // Thu-Fri = 1 each
      ],
    });
    const load = buildResourceLoad(schedule);
    const arr = load.get(100)!;
    expect(arr[0]).toBe(2);
    expect(arr[2]).toBe(2);
    expect(arr[3]).toBe(1);
    expect(arr[4]).toBe(1);
  });

  test("skips non-working days", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [{ taskUniqueId: 1, resourceUniqueId: 100, units: 3 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 7, modeId: null }],
    });
    const load = buildResourceLoad(schedule);
    const arr = load.get(100)!;
    // Sat (day 5) and Sun (day 6) should be 0; Mon Jan 5 is day 0 in this epoch.
    expect(arr[5]).toBe(0);
    expect(arr[6]).toBe(0);
  });

  test("returns an entry for each assigned resource even with zero placement", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100, 200],
      assignments: [{ taskUniqueId: 1, resourceUniqueId: 200, units: 1 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 5, modeId: null }],
    });
    const load = buildResourceLoad(schedule);
    expect(load.has(200)).toBe(true);
    // 100 has no assignments at all, so it's absent.
    expect(load.has(100)).toBe(false);
  });
});

describe("weeklyProfile — peakLoad / combinedPeakLoad", () => {
  test("peakLoad returns the highest single-day demand", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 100, units: 2 },
        { taskUniqueId: 2, resourceUniqueId: 100, units: 3 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 2, finishDay: 5, modeId: null },
      ],
    });
    const load = buildResourceLoad(schedule);
    // Days 2-4 overlap → 2+3 = 5.
    expect(peakLoad(load, 100)).toBe(5);
  });

  test("combinedPeakLoad sums across resources before maxing", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100, 200],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 100, units: 2 },
        { taskUniqueId: 2, resourceUniqueId: 200, units: 3 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
    });
    const load = buildResourceLoad(schedule);
    expect(combinedPeakLoad(load, [100, 200])).toBe(5);
  });

  test("peakLoad returns 0 for unknown resource", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [{ taskUniqueId: 1, resourceUniqueId: 100, units: 1 }],
      scheduledTasks: [{ uniqueId: 1, startDay: 0, finishDay: 5, modeId: null }],
    });
    const load = buildResourceLoad(schedule);
    expect(peakLoad(load, 999)).toBe(0);
  });
});

describe("weeklyProfile — snapToSunday & weeklyProfile", () => {
  test("snapToSunday on Mon Jan 5 2026 (day 0) returns day -1 (Sun Jan 4)", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [],
      scheduledTasks: [],
    });
    // Mon Jan 5 2026 → snap back to Sun Jan 4 = day -1.
    expect(snapToSunday(schedule.resolved, 0)).toBe(-1);
    // Wed Jan 7 = day 2 → snap back to Sun Jan 4 = day -1.
    expect(snapToSunday(schedule.resolved, 2)).toBe(-1);
    // Sun Jan 11 = day 6 → snap to itself.
    expect(snapToSunday(schedule.resolved, 6)).toBe(6);
  });

  test("weeklyProfile bins working-day peaks into 7-day windows", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [{ taskUniqueId: 1, resourceUniqueId: 100, units: 2 }],
      scheduledTasks: [
        // Mon-Fri week 1: 5 working days at 2 each.
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
      ],
    });
    const load = buildResourceLoad(schedule);
    const profile = weeklyProfile(schedule.resolved, load.get(100), 0, 4);
    // Window starting Sun Jan 4 (day -1) captures Mon Jan 5 → peak 2.
    expect(profile.length).toBeGreaterThan(0);
    expect(profile[0]!.weekStart).toBe(-1);
    expect(profile[0]!.value).toBe(2);
  });

  test("weeklyProfileCombined sums across resources within each week", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100, 200],
      assignments: [
        { taskUniqueId: 1, resourceUniqueId: 100, units: 1 },
        { taskUniqueId: 2, resourceUniqueId: 200, units: 2 },
      ],
      scheduledTasks: [
        { uniqueId: 1, startDay: 0, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 5, modeId: null },
      ],
    });
    const load = buildResourceLoad(schedule);
    const arrs = [load.get(100)!, load.get(200)!];
    const profile = weeklyProfileCombined(schedule.resolved, arrs, 0, 4);
    expect(profile[0]!.value).toBe(3);
  });

  test("weeklyProfile returns empty when arr is undefined", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [],
      scheduledTasks: [],
    });
    expect(weeklyProfile(schedule.resolved, undefined, 0, 10)).toEqual([]);
  });
});

describe("weeklyProfile — scheduleSpan", () => {
  test("returns earliest start and latest finish", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [{ taskUniqueId: 1, resourceUniqueId: 100, units: 1 }],
      scheduledTasks: [
        { uniqueId: 1, startDay: 2, finishDay: 5, modeId: null },
        { uniqueId: 2, startDay: 0, finishDay: 12, modeId: null },
      ],
    });
    expect(scheduleSpan(schedule)).toEqual({ startDay: 0, endDay: 12 });
  });

  test("empty schedule returns zero range", () => {
    const schedule = makeSchedule({
      resourceUniqueIds: [100],
      assignments: [],
      scheduledTasks: [],
    });
    expect(scheduleSpan(schedule)).toEqual({ startDay: 0, endDay: 0 });
  });
});
