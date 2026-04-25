import { test, expect, describe } from "bun:test";

import { Duration } from "../../src/model/Duration.ts";
import { RelationType, TimeUnit } from "../../src/model/types.ts";
import {
  addCalendarDays,
  calendarDayOffset,
  dayIndexToDate,
  startOfLocalDay,
} from "../../src/level-core/calendarDays.ts";
import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import type { Calendar, CalendarException } from "../../src/schema/calendar.ts";
import type { ProjectFile } from "../../src/schema/project.ts";
import type { Relation } from "../../src/schema/relation.ts";
import type { Task } from "../../src/schema/task.ts";

function monFriCalendar(uniqueId = 1, exceptions: CalendarException[] = []): Calendar {
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
    exceptions,
  };
}

function makeTask(args: {
  uniqueId: number;
  start: Date;
  finish: Date;
  predecessors?: Relation[];
  milestone?: boolean;
  duration?: Duration | null;
}): Task {
  return {
    id: null,
    uniqueId: args.uniqueId,
    name: `Task ${String(args.uniqueId)}`,
    wbs: null,
    outlineLevel: 0,
    start: args.start,
    finish: args.finish,
    duration: args.duration ?? null,
    percentComplete: null,
    summary: false,
    milestone: args.milestone ?? false,
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
    predecessors: args.predecessors ?? [],
  };
}

function makeProject(tasks: Task[], calendars: Calendar[] = [monFriCalendar()]): ProjectFile {
  return {
    properties: {
      title: "Test",
      author: null,
      startDate: null,
      finishDate: null,
      statusDate: null,
      defaultCalendarUniqueId: calendars[0]?.uniqueId ?? null,
      minutesPerDay: 480,
      minutesPerWeek: 2400,
      daysPerMonth: 20,
      saveVersion: null,
    },
    tasks,
    resources: [],
    assignments: [],
    calendars,
  };
}

// 2026-01-05 is a Monday (Jan 1 2026 = Thu).
const MON_JAN_5 = new Date(2026, 0, 5);
const SAT_JAN_10 = new Date(2026, 0, 10);
const TUE_JAN_13 = new Date(2026, 0, 13);

describe("resolveCalendar — Mon–Fri calendar", () => {
  test("1-week task spanning Mon–Fri", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]);
    const resolved = resolveCalendar(project);
    expect(resolved.tasks).toHaveLength(1);
    const t = resolved.tasks[0]!;
    expect(t.startDay).toBe(0);
    expect(t.finishDay).toBe(5);
    expect(t.durationDays).toBe(5);
  });

  test("MSPDI-style end-of-workday finish (Fri 17:00) rounds up to Sat midnight", () => {
    const friAt17 = new Date(2026, 0, 9, 17, 0, 0);
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: friAt17 })]);
    const resolved = resolveCalendar(project);
    expect(resolved.tasks[0]!.finishDay).toBe(5);
    expect(resolved.tasks[0]!.durationDays).toBe(5);
  });

  test("milestone (start === finish at midnight) has zero duration", () => {
    const project = makeProject([
      makeTask({ uniqueId: 1, start: MON_JAN_5, finish: MON_JAN_5, milestone: true }),
    ]);
    const t = resolveCalendar(project).tasks[0]!;
    expect(t.startDay).toBe(0);
    expect(t.finishDay).toBe(0);
    expect(t.durationDays).toBe(0);
    expect(t.milestone).toBe(true);
  });

  test("origin is start-of-day even when source uses non-midnight times", () => {
    const monAt9 = new Date(2026, 0, 5, 9, 0, 0);
    const project = makeProject([makeTask({ uniqueId: 1, start: monAt9, finish: SAT_JAN_10 })]);
    const resolved = resolveCalendar(project);
    expect(resolved.calendar.origin.getHours()).toBe(0);
    expect(resolved.calendar.origin.getDate()).toBe(5);
    expect(resolved.tasks[0]!.startDay).toBe(0);
  });

  test("Sat/Sun gap is non-working in the bitmap", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: TUE_JAN_13 })]);
    const resolved = resolveCalendar(project);
    // Day 5 = Sat, day 6 = Sun → both non-working.
    expect(resolved.calendar.bitmap[5]).toBe(false);
    expect(resolved.calendar.bitmap[6]).toBe(false);
    expect(resolved.calendar.bitmap[7]).toBe(true);
    // Mon..Fri (5 working) + Mon (1 working) = 6, Tue 13 is exclusive.
    expect(resolved.tasks[0]!.durationDays).toBe(6);
  });
});

describe("resolveCalendar — exceptions", () => {
  test("mid-week non-working exception lengthens calendar span", () => {
    // Wed Jan 7 2026 marked non-working. A 5-working-day task starting Mon
    // Jan 5 must therefore end Tue Jan 13 (cal-day 8).
    const wedJan7 = new Date(2026, 0, 7);
    const calendar = monFriCalendar(1, [
      {
        name: "Plant maintenance",
        fromDate: wedJan7,
        toDate: wedJan7,
        working: false,
      },
    ]);
    const project = makeProject(
      [makeTask({ uniqueId: 1, start: MON_JAN_5, finish: TUE_JAN_13 })],
      [calendar],
    );
    const resolved = resolveCalendar(project);
    expect(resolved.calendar.bitmap[2]).toBe(false); // Wed Jan 7 is now non-working.
    expect(resolved.tasks[0]!.startDay).toBe(0);
    expect(resolved.tasks[0]!.finishDay).toBe(8);
    expect(resolved.tasks[0]!.durationDays).toBe(5);
  });

  test("exception with `working: null` is treated as non-working", () => {
    const wedJan7 = new Date(2026, 0, 7);
    const calendar = monFriCalendar(1, [
      { name: "Holiday", fromDate: wedJan7, toDate: wedJan7, working: null },
    ]);
    const project = makeProject(
      [makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })],
      [calendar],
    );
    expect(resolveCalendar(project).calendar.bitmap[2]).toBe(false);
  });
});

describe("resolveCalendar — precedence edges", () => {
  test("FS edge with 2-day working-day lag carries lagDays through", () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: TUE_JAN_13,
      finish: new Date(2026, 0, 20),
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToStart,
          lag: Duration.from(2, TimeUnit.Days),
        },
      ],
    });
    const project = makeProject([t1, t2]);
    const resolved = resolveCalendar(project);
    expect(resolved.precedences).toHaveLength(1);
    expect(resolved.precedences[0]).toEqual({
      predecessorUniqueId: 1,
      successorUniqueId: 2,
      type: RelationType.FinishToStart,
      lagDays: 2,
    });
  });

  test("week-unit lag converts to 5 working days", () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: TUE_JAN_13,
      finish: new Date(2026, 0, 20),
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.StartToStart,
          lag: Duration.from(1, TimeUnit.Weeks),
        },
      ],
    });
    expect(resolveCalendar(makeProject([t1, t2])).precedences[0]!.lagDays).toBe(5);
  });
});

describe("resolveCalendar — assignments + source preservation", () => {
  test("assignments pass through with default units = 1 when null", () => {
    const project: ProjectFile = {
      ...makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]),
      assignments: [
        {
          taskUniqueId: 1,
          resourceUniqueId: 10,
          work: null,
          units: null,
          start: null,
          finish: null,
          actualWork: null,
          remainingWork: null,
        },
      ],
    };
    const resolved = resolveCalendar(project);
    expect(resolved.assignments).toEqual([{ taskUniqueId: 1, resourceUniqueId: 10, units: 1 }]);
  });

  test("`source` field is the input project (identity)", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]);
    const resolved = resolveCalendar(project);
    expect(resolved.source).toBe(project);
  });
});

describe("resolveCalendar — fallback calendar", () => {
  test("missing calendars synthesizes a Mon–Fri calendar", () => {
    const project = makeProject(
      [makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })],
      [],
    );
    const resolved = resolveCalendar(project);
    expect(resolved.calendar.calendarUniqueId).toBeNull();
    expect(resolved.calendar.bitmap[0]).toBe(true); // Mon
    expect(resolved.calendar.bitmap[5]).toBe(false); // Sat
  });
});

describe("resolveCalendar — error paths", () => {
  test("task missing start throws", () => {
    const broken = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([{ ...broken, start: null }]);
    expect(() => resolveCalendar(project)).toThrow(/missing start or finish/);
  });

  test("task missing uniqueId throws", () => {
    const broken = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([{ ...broken, uniqueId: null }]);
    expect(() => resolveCalendar(project)).toThrow(/missing uniqueId/);
  });
});

describe("calendarDays helpers", () => {
  test("calendarDayOffset round-trips with addCalendarDays", () => {
    const origin = MON_JAN_5;
    for (let n = 0; n < 30; n++) {
      const reconstructed = dayIndexToDate(n, origin);
      expect(calendarDayOffset(reconstructed, origin)).toBe(n);
    }
  });

  test("startOfLocalDay strips time-of-day", () => {
    const dt = new Date(2026, 0, 5, 13, 45, 30, 999);
    const start = startOfLocalDay(dt);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(start.getDate()).toBe(5);
  });

  test("addCalendarDays survives a DST boundary in northern hemisphere", () => {
    // 2026 US DST starts Sun Mar 8. Cross the boundary by adding 7 cal days.
    const beforeDst = new Date(2026, 2, 6); // Fri Mar 6
    const after = addCalendarDays(beforeDst, 7);
    expect(after.getDate()).toBe(13);
    expect(after.getMonth()).toBe(2);
    expect(after.getHours()).toBe(0);
    expect(calendarDayOffset(after, beforeDst)).toBe(7);
  });
});
