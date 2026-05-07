import { test, expect, describe } from "bun:test";

import { currentSchedule } from "../../src/level-core/currentSchedule.ts";
import { materialize } from "../../src/level-core/materialize.ts";
import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import type { Schedule } from "../../src/level-core/types.ts";
import { Duration } from "../../src/model/Duration.ts";
import { ResourceType, TimeUnit } from "../../src/model/types.ts";
import type { Calendar, CalendarException } from "../../src/schema/calendar.ts";
import type { ProjectFile } from "../../src/schema/project.ts";
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
  duration?: Duration | null;
  notes?: string | null;
  baselineStart?: Date | null;
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
    milestone: false,
    critical: null,
    notes: args.notes ?? null,
    priority: null,
    cost: null,
    work: null,
    actualStart: null,
    actualFinish: null,
    baselineStart: args.baselineStart ?? null,
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

const MON_JAN_5 = new Date(2026, 0, 5);
const SAT_JAN_10 = new Date(2026, 0, 10);

describe("materialize — round-trip", () => {
  test("resolve → currentSchedule → materialize → resolve gives same day indices", () => {
    const project = makeProject([
      makeTask({
        uniqueId: 1,
        start: MON_JAN_5,
        finish: SAT_JAN_10,
        duration: Duration.from(5, TimeUnit.Days),
      }),
    ]);
    const resolved1 = resolveCalendar(project);
    const sched1 = currentSchedule(resolved1);
    const out = materialize(sched1);
    const resolved2 = resolveCalendar(out);
    const sched2 = currentSchedule(resolved2);
    expect(sched2.tasks[0]!.startDay).toBe(sched1.tasks[0]!.startDay);
    expect(sched2.tasks[0]!.finishDay).toBe(sched1.tasks[0]!.finishDay);
    expect(resolved2.tasks[0]!.durationDays).toBe(resolved1.tasks[0]!.durationDays);
  });

  test("MSPDI Fri 17:00 finish round-trips through midnight normalization (N3)", () => {
    const friAt17 = new Date(2026, 0, 9, 17, 0, 0);
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: friAt17 })]);
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.tasks[0]!.finish).toEqual(new Date(2026, 0, 10));
    expect(currentSchedule(resolveCalendar(out)).tasks[0]!.finishDay).toBe(5);
  });
});

describe("materialize — field preservation", () => {
  test("notes and baselineStart pass through unchanged", () => {
    const baseline = new Date(2026, 0, 5);
    const project = makeProject([
      makeTask({
        uniqueId: 1,
        start: MON_JAN_5,
        finish: SAT_JAN_10,
        notes: "do not lose me",
        baselineStart: baseline,
      }),
    ]);
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.tasks[0]!.notes).toBe("do not lose me");
    expect(out.tasks[0]!.baselineStart).toEqual(baseline);
  });

  test("source-level resources/assignments/calendars/properties survive", () => {
    const project: ProjectFile = {
      ...makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]),
      resources: [
        {
          id: 1,
          uniqueId: 1,
          name: "Crew A",
          type: ResourceType.Work,
          email: null,
          group: null,
          maxUnits: null,
          cost: null,
          work: null,
          resourcePool: null,
        },
      ],
      properties: {
        title: "Authoritative title",
        author: "RF",
        startDate: null,
        finishDate: null,
        statusDate: null,
        defaultCalendarUniqueId: 1,
        minutesPerDay: 480,
        minutesPerWeek: 2400,
        daysPerMonth: 20,
        saveVersion: 14,
      },
    };
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.resources).toHaveLength(1);
    expect(out.resources[0]!.name).toBe("Crew A");
    expect(out.properties.title).toBe("Authoritative title");
    expect(out.properties.author).toBe("RF");
    expect(out.properties.saveVersion).toBe(14);
    expect(out.calendars).toHaveLength(1);
  });

  test("tasks not in schedule pass through unchanged", () => {
    const project = makeProject([
      makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 }),
      makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 }),
    ]);
    const resolved = resolveCalendar(project);
    const partial: Schedule = {
      resolved,
      tasks: [{ uniqueId: 1, startDay: 7, finishDay: 12, modeId: null }],
      makespan: 12,
      annotations: new Map(),
    };
    const out = materialize(partial);
    expect(out.tasks[0]!.start).toEqual(new Date(2026, 0, 12)); // shifted
    expect(out.tasks[1]!.start).toEqual(MON_JAN_5); // untouched
    expect(out.tasks[1]!.finish).toEqual(SAT_JAN_10);
  });
});

describe("materialize — duration update across units", () => {
  test("Days-unit duration mirrors working-day count", () => {
    const project = makeProject([
      makeTask({
        uniqueId: 1,
        start: MON_JAN_5,
        finish: SAT_JAN_10,
        duration: Duration.from(5, TimeUnit.Days),
      }),
    ]);
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.tasks[0]!.duration?.unit).toBe(TimeUnit.Days);
    expect(out.tasks[0]!.duration?.value).toBe(5);
  });

  test("Hours-unit duration scales by minutesPerDay", () => {
    const project = makeProject([
      makeTask({
        uniqueId: 1,
        start: MON_JAN_5,
        finish: SAT_JAN_10,
        duration: Duration.from(40, TimeUnit.Hours),
      }),
    ]);
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.tasks[0]!.duration?.unit).toBe(TimeUnit.Hours);
    expect(out.tasks[0]!.duration?.value).toBe(40); // 5 days × 480 min / 60
  });

  test("Weeks-unit duration uses minutesPerWeek/minutesPerDay", () => {
    const project = makeProject([
      makeTask({
        uniqueId: 1,
        start: MON_JAN_5,
        finish: SAT_JAN_10,
        duration: Duration.from(1, TimeUnit.Weeks),
      }),
    ]);
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.tasks[0]!.duration?.unit).toBe(TimeUnit.Weeks);
    expect(out.tasks[0]!.duration?.value).toBe(1);
  });

  test("null source duration emits Days-unit by default", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]);
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.tasks[0]!.duration?.unit).toBe(TimeUnit.Days);
    expect(out.tasks[0]!.duration?.value).toBe(5);
  });

  test("non-working exception in window keeps duration aligned to working-day count", () => {
    const wedJan7 = new Date(2026, 0, 7);
    const project = makeProject(
      [
        makeTask({
          uniqueId: 1,
          start: MON_JAN_5,
          finish: new Date(2026, 0, 13),
          duration: Duration.from(5, TimeUnit.Days),
        }),
      ],
      [
        monFriCalendar(1, [
          { name: "Holiday", fromDate: wedJan7, toDate: wedJan7, working: false },
        ]),
      ],
    );
    const out = materialize(currentSchedule(resolveCalendar(project)));
    expect(out.tasks[0]!.duration?.value).toBe(5);
  });
});

describe("materialize — schedule shifts", () => {
  test("shifting startDay by 7 cal days updates finish dates correctly", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]);
    const resolved = resolveCalendar(project);
    const seed = currentSchedule(resolved).tasks[0]!;
    const shifted: Schedule = {
      resolved,
      tasks: [
        { uniqueId: 1, startDay: seed.startDay + 7, finishDay: seed.finishDay + 7, modeId: null },
      ],
      makespan: seed.finishDay + 7,
      annotations: new Map(),
    };
    const out = materialize(shifted);
    expect(out.tasks[0]!.start).toEqual(new Date(2026, 0, 12));
    expect(out.tasks[0]!.finish).toEqual(new Date(2026, 0, 17));
  });
});

describe("materialize — error paths", () => {
  test("mode-change task throws (not yet supported)", () => {
    const project = makeProject([makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 })]);
    const resolved = resolveCalendar(project);
    const sched: Schedule = {
      resolved,
      tasks: [{ uniqueId: 1, startDay: 0, finishDay: 5, modeId: 2 }],
      makespan: 5,
      annotations: new Map(),
    };
    expect(() => materialize(sched)).toThrow(/mode-change/);
  });
});
