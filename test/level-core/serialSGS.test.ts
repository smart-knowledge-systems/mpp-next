import { test, expect, describe } from "bun:test";

import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import { ScheduleStreamImpl } from "../../src/level-core/scheduleStream.ts";
import { serialSGS } from "../../src/level-core/search/serialSGS.ts";
import { Duration } from "../../src/model/Duration.ts";
import { RelationType, ResourceType, TimeUnit } from "../../src/model/types.ts";
import type { Constraint, Schedule } from "../../src/level-core/types.ts";
import type { Calendar } from "../../src/schema/calendar.ts";
import type { ProjectFile } from "../../src/schema/project.ts";
import type { Relation } from "../../src/schema/relation.ts";
import type { Task } from "../../src/schema/task.ts";

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

function makeTask(args: {
  uniqueId: number;
  start: Date;
  finish: Date;
  predecessors?: Relation[];
}): Task {
  return {
    id: null,
    uniqueId: args.uniqueId,
    name: `Task ${String(args.uniqueId)}`,
    wbs: null,
    outlineLevel: 0,
    start: args.start,
    finish: args.finish,
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
    predecessors: args.predecessors ?? [],
  };
}

function makeProject(
  tasks: Task[],
  options: {
    calendars?: Calendar[];
    resources?: ProjectFile["resources"];
    assignments?: ProjectFile["assignments"];
  } = {},
): ProjectFile {
  const calendars = options.calendars ?? [monFriCalendar()];
  return {
    properties: {
      title: null,
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
    resources: options.resources ?? [],
    assignments: options.assignments ?? [],
    calendars,
  };
}

const MON_JAN_5 = new Date(2026, 0, 5);
const FRI_JAN_9 = new Date(2026, 0, 9);
const SAT_JAN_10 = new Date(2026, 0, 10);

async function runOnce(
  project: ProjectFile,
  constraints: ReadonlyArray<Constraint>,
): Promise<Schedule> {
  const resolved = resolveCalendar(project);
  const stream = new ScheduleStreamImpl({
    [Symbol.asyncIterator]: () => serialSGS.run(resolved, constraints),
  });
  const collected = await stream.collect();
  expect(collected).toHaveLength(1);
  return collected[0]!;
}

describe("serialSGS — precedence", () => {
  test("3-task FS chain serializes back-to-back when no resources", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToStart,
          lag: null,
        },
      ],
    });
    const t3 = makeTask({
      uniqueId: 3,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 2,
          successorUniqueId: 3,
          type: RelationType.FinishToStart,
          lag: null,
        },
      ],
    });
    const schedule = await runOnce(makeProject([t1, t2, t3]), []);
    const byId = new Map(schedule.tasks.map((t) => [t.uniqueId, t]));
    expect(byId.get(1)!.startDay).toBe(0);
    expect(byId.get(1)!.finishDay).toBe(5);
    // T2 starts day 7 (Mon Jan 12) — Sat/Sun bridge from Sat Jan 10.
    expect(byId.get(2)!.startDay).toBe(7);
    expect(byId.get(2)!.finishDay).toBe(12);
    // T3 starts day 14 (Mon Jan 19) after another weekend bridge.
    expect(byId.get(3)!.startDay).toBe(14);
    expect(byId.get(3)!.finishDay).toBe(19);
  });

  test("FS lag of 2 working days delays successor", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToStart,
          lag: Duration.from(2, TimeUnit.Days),
        },
      ],
    });
    const schedule = await runOnce(makeProject([t1, t2]), []);
    const t2sched = schedule.tasks.find((t) => t.uniqueId === 2)!;
    // T1 finishDay=5 (Sat). +2 working days = Mon Jan 12 + Tue Jan 13 → start Wed Jan 14 = day 9.
    // Then 5 working days (Wed/Thu/Fri/Mon/Tue) lands finish at day 16 (Wed Jan 21).
    expect(t2sched.startDay).toBe(9);
    expect(t2sched.finishDay).toBe(16);
  });

  test("cycle in precedence throws", async () => {
    const t1 = makeTask({
      uniqueId: 1,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 2,
          successorUniqueId: 1,
          type: RelationType.FinishToStart,
          lag: null,
        },
      ],
    });
    const t2 = makeTask({
      uniqueId: 2,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToStart,
          lag: null,
        },
      ],
    });
    expect(runOnce(makeProject([t1, t2]), [])).rejects.toThrow(/cycle/);
  });
});

describe("serialSGS — resource caps", () => {
  test("MaxConcurrentResource{max:1} serializes two parallel tasks", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([t1, t2], {
      resources: [
        {
          id: 1,
          uniqueId: 100,
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
      assignments: [
        {
          taskUniqueId: 1,
          resourceUniqueId: 100,
          work: null,
          units: 1,
          start: null,
          finish: null,
          actualWork: null,
          remainingWork: null,
        },
        {
          taskUniqueId: 2,
          resourceUniqueId: 100,
          work: null,
          units: 1,
          start: null,
          finish: null,
          actualWork: null,
          remainingWork: null,
        },
      ],
    });
    const schedule = await runOnce(project, [
      { kind: "MaxConcurrentResource", resourceUniqueId: 100, max: 1 },
    ]);
    const t1sched = schedule.tasks.find((t) => t.uniqueId === 1)!;
    const t2sched = schedule.tasks.find((t) => t.uniqueId === 2)!;
    expect(t1sched.startDay).toBe(0);
    expect(t1sched.finishDay).toBe(5);
    // T2 must wait until T1's resource window is clear — next working day after 5.
    expect(t2sched.startDay).toBe(7); // skip Sat/Sun
    expect(t2sched.finishDay).toBe(12);
  });

  test("MaxConcurrentResource{max:2} permits both tasks in parallel", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([t1, t2], {
      resources: [
        {
          id: 1,
          uniqueId: 100,
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
      assignments: [
        {
          taskUniqueId: 1,
          resourceUniqueId: 100,
          work: null,
          units: 1,
          start: null,
          finish: null,
          actualWork: null,
          remainingWork: null,
        },
        {
          taskUniqueId: 2,
          resourceUniqueId: 100,
          work: null,
          units: 1,
          start: null,
          finish: null,
          actualWork: null,
          remainingWork: null,
        },
      ],
    });
    const schedule = await runOnce(project, [
      { kind: "MaxConcurrentResource", resourceUniqueId: 100, max: 2 },
    ]);
    const t1sched = schedule.tasks.find((t) => t.uniqueId === 1)!;
    const t2sched = schedule.tasks.find((t) => t.uniqueId === 2)!;
    expect(t1sched.startDay).toBe(0);
    expect(t2sched.startDay).toBe(0);
  });

  test("PeakCap with window only constrains inside the window", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: FRI_JAN_9 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: FRI_JAN_9 });
    const project = makeProject([t1, t2], {
      resources: [
        {
          id: 1,
          uniqueId: 200,
          name: "Specialist",
          type: ResourceType.Work,
          email: null,
          group: null,
          maxUnits: null,
          cost: null,
          work: null,
          resourcePool: null,
        },
      ],
      assignments: [
        {
          taskUniqueId: 1,
          resourceUniqueId: 200,
          work: null,
          units: 1,
          start: null,
          finish: null,
          actualWork: null,
          remainingWork: null,
        },
        {
          taskUniqueId: 2,
          resourceUniqueId: 200,
          work: null,
          units: 1,
          start: null,
          finish: null,
          actualWork: null,
          remainingWork: null,
        },
      ],
    });
    // Cap of 1 applies only days 100–200 — completely outside our scheduling
    // horizon, so tasks should run in parallel.
    const schedule = await runOnce(project, [
      {
        kind: "PeakCap",
        resourceUniqueId: 200,
        cap: 1,
        window: { fromDay: 100, toDay: 200 },
      },
    ]);
    expect(schedule.tasks.find((t) => t.uniqueId === 1)!.startDay).toBe(0);
    expect(schedule.tasks.find((t) => t.uniqueId === 2)!.startDay).toBe(0);
  });
});

describe("serialSGS — unimplemented constraints", () => {
  test("UnimodalProfile records an Explanation but does not block emission", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const schedule = await runOnce(makeProject([t1]), [
      {
        kind: "UnimodalProfile",
        resourceUniqueId: 100,
        tolerance: 0.1,
      },
    ]);
    expect(schedule.tasks).toHaveLength(1);
    expect(schedule.explanations).toHaveLength(1);
    expect(schedule.explanations[0]!.message).toMatch(/UnimodalProfile.*not implemented/);
  });
});

describe("serialSGS — milestones", () => {
  test("zero-duration task is placed at the precedence lower bound", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const milestone = makeTask({
      uniqueId: 2,
      start: SAT_JAN_10,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToStart,
          lag: null,
        },
      ],
    });
    milestone.milestone = true;
    const schedule = await runOnce(makeProject([t1, milestone]), []);
    const m = schedule.tasks.find((t) => t.uniqueId === 2)!;
    expect(m.startDay).toBe(5);
    expect(m.finishDay).toBe(5);
  });
});

describe("serialSGS — bestBy integration", () => {
  test("ScheduleStream.bestBy works with serialSGS output", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([t1]);
    const resolved = resolveCalendar(project);
    const stream = new ScheduleStreamImpl({
      [Symbol.asyncIterator]: () => serialSGS.run(resolved, []),
    });
    const best = await stream.bestBy({
      name: "makespan",
      direction: "min",
      score: (s) => Math.max(...s.tasks.map((t) => t.finishDay)),
    });
    expect(best?.tasks[0]!.finishDay).toBe(5);
  });
});
