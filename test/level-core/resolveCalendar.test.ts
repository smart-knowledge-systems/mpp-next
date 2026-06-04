import { test, expect, describe } from "bun:test";

import { currentSchedule } from "../../src/level-core/currentSchedule.ts";
import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import { Duration } from "../../src/model/Duration.ts";
import { RelationType, TimeUnit } from "../../src/model/types.ts";
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
  start: Date | null;
  finish: Date | null;
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

function defaultCal(resolved: ReturnType<typeof resolveCalendar>) {
  const id = resolved.defaultCalendarUniqueId;
  return id !== null ? resolved.calendars.get(id)! : resolved.calendars.values().next().value!;
}

const MON_JAN_5 = new Date(2026, 0, 5);
const SAT_JAN_10 = new Date(2026, 0, 10);
const TUE_JAN_13 = new Date(2026, 0, 13);

describe("resolveCalendar — Mon–Fri calendar", () => {
  test("1-week task: durationDays = 5, currentSchedule places at days 0..5", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]);
    const resolved = resolveCalendar(project);
    expect(resolved.tasks[0]!.durationDays).toBe(5);
    const schedule = currentSchedule(resolved);
    expect(schedule.tasks[0]).toEqual({ uniqueId: 1, startDay: 0, finishDay: 5, modeId: null });
    expect(schedule.makespan).toBe(5);
  });

  test("MSPDI Fri 17:00 finish rounds up to Sat midnight", () => {
    const friAt17 = new Date(2026, 0, 9, 17, 0, 0);
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: friAt17 })]);
    const resolved = resolveCalendar(project);
    expect(currentSchedule(resolved).tasks[0]!.finishDay).toBe(5);
  });

  test("milestone (start === finish at midnight) has zero duration", () => {
    const project = makeProject([
      makeTask({ uniqueId: 1, start: MON_JAN_5, finish: MON_JAN_5, milestone: true }),
    ]);
    const resolved = resolveCalendar(project);
    expect(resolved.tasks[0]!.durationDays).toBe(0);
    expect(resolved.tasks[0]!.milestone).toBe(true);
    expect(currentSchedule(resolved).tasks[0]!.startDay).toBe(0);
    expect(currentSchedule(resolved).tasks[0]!.finishDay).toBe(0);
  });

  test("epoch is start-of-day even when source uses non-midnight times", () => {
    const monAt9 = new Date(2026, 0, 5, 9, 0, 0);
    const project = makeProject([makeTask({ uniqueId: 1, start: monAt9, finish: SAT_JAN_10 })]);
    const resolved = resolveCalendar(project);
    const cal = defaultCal(resolved);
    expect(cal.epoch.getHours()).toBe(0);
    expect(cal.epoch.getDate()).toBe(5);
  });

  test("Sat/Sun gap is non-working in the bits", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: TUE_JAN_13 })]);
    const cal = defaultCal(resolveCalendar(project));
    expect(cal.bits[5]).toBe(0);
    expect(cal.bits[6]).toBe(0);
    expect(cal.bits[7]).toBe(1);
  });
});

describe("resolveCalendar — exceptions", () => {
  test("mid-week non-working exception lengthens span", () => {
    const wedJan7 = new Date(2026, 0, 7);
    const calendar = monFriCalendar(1, [
      { name: "Plant maintenance", fromDate: wedJan7, toDate: wedJan7, working: false },
    ]);
    const project = makeProject(
      [makeTask({ uniqueId: 1, start: MON_JAN_5, finish: TUE_JAN_13 })],
      [calendar],
    );
    const resolved = resolveCalendar(project);
    expect(defaultCal(resolved).bits[2]).toBe(0);
    // 5 working days with one mid-week non-working day → start 0, finish 8.
    const sched = currentSchedule(resolved).tasks[0]!;
    expect(sched.startDay).toBe(0);
    expect(sched.finishDay).toBe(8);
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
    expect(defaultCal(resolveCalendar(project)).bits[2]).toBe(0);
  });
});

describe("resolveCalendar — precedence edges", () => {
  test("FS edge with 2-day lag carries lagDays through", () => {
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
    const resolved = resolveCalendar(makeProject([t1, t2]));
    expect(resolved.precedences[0]).toEqual({
      predecessorUniqueId: 1,
      successorUniqueId: 2,
      type: RelationType.FinishToStart,
      lagDays: 2,
    });
  });

  test("week-unit lag uses minutesPerWeek/minutesPerDay (not hardcoded 5)", () => {
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
    // 480 min/day, 2400 min/week → 5 working days/week.
    expect(resolveCalendar(makeProject([t1, t2])).precedences[0]!.lagDays).toBe(5);
  });

  test("week-unit lag honors a 6-day workweek (minutesPerWeek = 2880)", () => {
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
    const project: ProjectFile = {
      ...makeProject([t1, t2]),
      properties: {
        title: null,
        author: null,
        startDate: null,
        finishDate: null,
        statusDate: null,
        defaultCalendarUniqueId: 1,
        minutesPerDay: 480,
        minutesPerWeek: 2880, // 6 working days/week
        daysPerMonth: 20,
        saveVersion: null,
      },
    };
    expect(resolveCalendar(project).precedences[0]!.lagDays).toBe(6);
  });
});

describe("resolveCalendar — assignments, resources, source preservation", () => {
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
    expect(resolveCalendar(project).assignments).toEqual([
      { taskUniqueId: 1, resourceUniqueId: 10, units: 1 },
    ]);
  });

  test("capacityPerDay = (maxUnits ?? 1) * (minutesPerDay/60)", () => {
    // 480 min/day → 8 hours/day; maxUnits = 2 → capacity = 16.
    const project: ProjectFile = {
      ...makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]),
      resources: [
        {
          id: 10,
          uniqueId: 10,
          name: "Crew",
          type: "Work" as never,
          email: null,
          group: null,
          maxUnits: 2,
          cost: null,
          work: null,
          resourcePool: null,
        },
      ],
    };
    expect(resolveCalendar(project).resources).toEqual([
      { uniqueId: 10, capacityPerDay: 16, calendarUniqueId: null },
    ]);
  });

  test("`source` field is the input project (identity)", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]);
    expect(resolveCalendar(project).source).toBe(project);
  });
});

describe("resolveCalendar — epoch", () => {
  test("opts.epoch wins over statusDate and task starts", () => {
    const explicitEpoch = new Date(2025, 11, 29); // Mon Dec 29 2025
    const project: ProjectFile = {
      ...makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]),
      properties: {
        title: null,
        author: null,
        startDate: null,
        finishDate: null,
        statusDate: new Date(2026, 0, 1),
        defaultCalendarUniqueId: 1,
        minutesPerDay: 480,
        minutesPerWeek: 2400,
        daysPerMonth: 20,
        saveVersion: null,
      },
    };
    const resolved = resolveCalendar(project, { epoch: explicitEpoch });
    expect(defaultCal(resolved).epoch.getDate()).toBe(29);
    expect(defaultCal(resolved).epoch.getMonth()).toBe(11);
  });

  test("statusDate is used when opts.epoch is absent", () => {
    const project: ProjectFile = {
      ...makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]),
      properties: {
        title: null,
        author: null,
        startDate: null,
        finishDate: null,
        statusDate: new Date(2025, 11, 30),
        defaultCalendarUniqueId: 1,
        minutesPerDay: 480,
        minutesPerWeek: 2400,
        daysPerMonth: 20,
        saveVersion: null,
      },
    };
    expect(defaultCal(resolveCalendar(project)).epoch.getDate()).toBe(30);
  });

  test("throws when neither opts.epoch, statusDate, startDate, nor task starts exist", () => {
    const project: ProjectFile = {
      ...makeProject([]),
    };
    expect(() => resolveCalendar(project)).toThrow(/cannot pick epoch/);
  });
});

describe("resolveCalendar — multi-calendar map", () => {
  test("default calendar lives in the map under its uniqueId", () => {
    const c1 = monFriCalendar(7);
    const project = makeProject(
      [makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })],
      [c1],
    );
    const resolved = resolveCalendar(project);
    expect(resolved.defaultCalendarUniqueId).toBe(7);
    expect(resolved.calendars.get(7)).toBeDefined();
  });

  test("non-default calendars also build in the map", () => {
    const c1 = monFriCalendar(1);
    const c2 = monFriCalendar(2);
    const project = makeProject(
      [makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })],
      [c1, c2],
    );
    const resolved = resolveCalendar(project);
    expect(resolved.calendars.has(1)).toBe(true);
    expect(resolved.calendars.has(2)).toBe(true);
  });

  test("missing calendars synthesizes a Mon–Fri fallback", () => {
    const project = makeProject(
      [makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })],
      [],
    );
    const resolved = resolveCalendar(project);
    expect(resolved.defaultCalendarUniqueId).toBeNull();
    expect(resolved.calendars.size).toBe(1);
    const cal = resolved.calendars.values().next().value!;
    expect(cal.bits[0]).toBe(1); // Mon
    expect(cal.bits[5]).toBe(0); // Sat
  });
});

describe("resolveCalendar — error paths", () => {
  test("task missing start throws", () => {
    const broken = makeTask({ uniqueId: 1, start: null, finish: SAT_JAN_10 });
    expect(() => resolveCalendar(makeProject([broken]))).toThrow(/missing start or finish/);
  });

  test("task missing uniqueId throws", () => {
    const broken = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    expect(() => resolveCalendar(makeProject([{ ...broken, uniqueId: null }]))).toThrow(
      /missing uniqueId/,
    );
  });
});
