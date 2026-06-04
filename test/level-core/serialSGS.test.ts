import { test, expect, describe } from "bun:test";

import { resolveCalendar } from "../../src/level-core/resolveCalendar.ts";
import { ScheduleStreamImpl } from "../../src/level-core/scheduleStream.ts";
import { serialSGS } from "../../src/level-core/search/serialSGS.ts";
import { Duration } from "../../src/model/Duration.ts";
import { RelationType, ResourceType, TimeUnit } from "../../src/model/types.ts";
import type {
  Constraint,
  Explanation,
  Failure,
  Schedule,
  WorkUnit,
} from "../../src/level-core/types.ts";
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
  workUnits?: ReadonlyArray<WorkUnit>,
): Promise<Schedule> {
  const resolved = resolveCalendar(project, { workUnits });
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

  test("MaxConcurrentResource counts tasks, not units (matches MiniZinc bool2int)", async () => {
    // Three tasks each at 0.5 units. Under unit-sum semantics with max=2,
    // up to 4 could run concurrently (4 * 0.5 = 2.0). Under task-count
    // semantics (matching MiniZinc), only 2 may run concurrently.
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t3 = makeTask({ uniqueId: 3, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([t1, t2, t3], {
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
      assignments: [1, 2, 3].map((taskUniqueId) => ({
        taskUniqueId,
        resourceUniqueId: 100,
        work: null,
        units: 0.5,
        start: null,
        finish: null,
        actualWork: null,
        remainingWork: null,
      })),
    });
    const schedule = await runOnce(project, [
      { kind: "MaxConcurrentResource", resourceUniqueId: 100, max: 2 },
    ]);
    const t1sched = schedule.tasks.find((t) => t.uniqueId === 1)!;
    const t2sched = schedule.tasks.find((t) => t.uniqueId === 2)!;
    const t3sched = schedule.tasks.find((t) => t.uniqueId === 3)!;
    // T1 and T2 may run together (2 tasks ≤ 2). T3 must wait.
    expect(t1sched.startDay).toBe(0);
    expect(t2sched.startDay).toBe(0);
    expect(t3sched.startDay).toBe(7);
  });

  test("PeakCap sums fractional units (distinct from MaxConcurrentResource)", async () => {
    // Same three half-unit tasks under PeakCap{cap:2}: 4 tasks at 0.5 each
    // sum to 2.0 — all three should run together, since 1.5 ≤ 2.
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t3 = makeTask({ uniqueId: 3, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([t1, t2, t3], {
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
      assignments: [1, 2, 3].map((taskUniqueId) => ({
        taskUniqueId,
        resourceUniqueId: 100,
        work: null,
        units: 0.5,
        start: null,
        finish: null,
        actualWork: null,
        remainingWork: null,
      })),
    });
    const schedule = await runOnce(project, [{ kind: "PeakCap", resourceUniqueId: 100, cap: 2 }]);
    expect(schedule.tasks.find((t) => t.uniqueId === 1)!.startDay).toBe(0);
    expect(schedule.tasks.find((t) => t.uniqueId === 2)!.startDay).toBe(0);
    expect(schedule.tasks.find((t) => t.uniqueId === 3)!.startDay).toBe(0);
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

describe("serialSGS — unit caps (ConcurrentUnitsLimit)", () => {
  const crewResource = {
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
  };
  const elecResource = { ...crewResource, id: 2, uniqueId: 200, name: "Electrical" };

  function assignment(taskUniqueId: number, resourceUniqueId: number) {
    return {
      taskUniqueId,
      resourceUniqueId,
      work: null,
      units: 1,
      start: null,
      finish: null,
      actualWork: null,
      remainingWork: null,
    };
  }

  test("whole-bay limit max=1 serializes two single-task units", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const schedule = await runOnce(
      makeProject([t1, t2]),
      [{ kind: "ConcurrentUnitsLimit", unitIds: [10, 20], max: 1 }],
      [
        { id: 10, taskUniqueIds: [1] },
        { id: 20, taskUniqueIds: [2] },
      ],
    );
    const t1s = schedule.tasks.find((t) => t.uniqueId === 1)!;
    const t2s = schedule.tasks.find((t) => t.uniqueId === 2)!;
    expect(t1s.startDay).toBe(0);
    expect(t1s.finishDay).toBe(5);
    // Unit 20 can't be open while unit 10 is — next working day after 5.
    expect(t2s.startDay).toBe(7);
  });

  test("whole-bay limit max=2 permits both units in parallel", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const schedule = await runOnce(
      makeProject([t1, t2]),
      [{ kind: "ConcurrentUnitsLimit", unitIds: [10, 20], max: 2 }],
      [
        { id: 10, taskUniqueIds: [1] },
        { id: 20, taskUniqueIds: [2] },
      ],
    );
    expect(schedule.tasks.find((t) => t.uniqueId === 1)!.startDay).toBe(0);
    expect(schedule.tasks.find((t) => t.uniqueId === 2)!.startDay).toBe(0);
  });

  test("two tasks in the SAME unit do not count twice against the cap", async () => {
    // Unit 10 holds both tasks; unit 20 is empty. max=1 must still allow the
    // two tasks of unit 10 to run together — one open unit, not two.
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const schedule = await runOnce(
      makeProject([t1, t2]),
      [{ kind: "ConcurrentUnitsLimit", unitIds: [10], max: 1 }],
      [{ id: 10, taskUniqueIds: [1, 2] }],
    );
    expect(schedule.tasks.find((t) => t.uniqueId === 1)!.startDay).toBe(0);
    expect(schedule.tasks.find((t) => t.uniqueId === 2)!.startDay).toBe(0);
  });

  test("discipline-scoped limit serializes only the discipline's tasks", async () => {
    // Each unit has one electrical task (res 200) and one general task (res 100).
    // ConcurrentUnitsLimit{discipline:200,max:1} may not have both units'
    // electrical work active together → electrical serializes; general work,
    // uncounted, stays parallel.
    const elecA = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const genA = makeTask({ uniqueId: 2, start: MON_JAN_5, finish: SAT_JAN_10 });
    const elecB = makeTask({ uniqueId: 3, start: MON_JAN_5, finish: SAT_JAN_10 });
    const genB = makeTask({ uniqueId: 4, start: MON_JAN_5, finish: SAT_JAN_10 });
    const project = makeProject([elecA, genA, elecB, genB], {
      resources: [crewResource, elecResource],
      assignments: [assignment(1, 200), assignment(2, 100), assignment(3, 200), assignment(4, 100)],
    });
    const schedule = await runOnce(
      project,
      [{ kind: "ConcurrentUnitsLimit", discipline: 200, unitIds: [10, 20], max: 1 }],
      [
        { id: 10, taskUniqueIds: [1, 2] },
        { id: 20, taskUniqueIds: [3, 4] },
      ],
    );
    const by = new Map(schedule.tasks.map((t) => [t.uniqueId, t]));
    // Electrical work serializes across the two units.
    expect(by.get(1)!.startDay).toBe(0);
    expect(by.get(3)!.startDay).toBe(7);
    // General work is not counted by the discipline cap — both at day 0.
    expect(by.get(2)!.startDay).toBe(0);
    expect(by.get(4)!.startDay).toBe(0);
  });
});

describe("serialSGS — unimplemented constraints", () => {
  test("UnimodalProfile records an Explanation in annotations but does not block emission", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const schedule = await runOnce(makeProject([t1]), [
      {
        kind: "UnimodalProfile",
        resourceUniqueId: 100,
        tolerance: 0.1,
      },
    ]);
    expect(schedule.tasks).toHaveLength(1);
    const unsupported = schedule.annotations.get("unsupportedConstraints") as
      | ReadonlyArray<Explanation>
      | undefined;
    expect(unsupported).toBeDefined();
    expect(unsupported).toHaveLength(1);
    expect(unsupported![0]!.message).toMatch(/UnimodalProfile.*not implemented/);
  });

  test("UnitPrecedence is recorded as unsupported (renamed from MultiBayPrecedence)", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const schedule = await runOnce(makeProject([t1]), [
      { kind: "UnitPrecedence", unitId: 20, afterUnitIds: [10] },
    ]);
    const unsupported = schedule.annotations.get("unsupportedConstraints") as
      | ReadonlyArray<Explanation>
      | undefined;
    expect(unsupported).toBeDefined();
    expect(unsupported![0]!.message).toMatch(/UnitPrecedence.*not implemented/);
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

describe("serialSGS — FF/SF approximation", () => {
  test("FF relation does not over-delay successor and emits approximatedRelations", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToFinish,
          lag: null,
        },
      ],
    });
    const schedule = await runOnce(makeProject([t1, t2]), []);
    const t1sched = schedule.tasks.find((t) => t.uniqueId === 1)!;
    const t2sched = schedule.tasks.find((t) => t.uniqueId === 2)!;
    // T1 occupies days 0–5. Under FS-degradation, T2 would have started at
    // day 7 (next working day). Under proper FF semantics with lag=0 and
    // duration=5, T2 can start at day 0 since its finish (day 5) >= T1's
    // finish (day 5). Verify we no longer over-delay.
    expect(t1sched.finishDay).toBe(5);
    expect(t2sched.startDay).toBe(0);
    const approximated = schedule.annotations.get("approximatedRelations") as
      | ReadonlyArray<Explanation>
      | undefined;
    expect(approximated).toBeDefined();
    expect(approximated!.length).toBe(1);
    expect(approximated![0]!.message).toMatch(/FF.*approximated/);
  });

  test("SF relation emits approximatedRelations", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.StartToFinish,
          lag: null,
        },
      ],
    });
    const schedule = await runOnce(makeProject([t1, t2]), []);
    const approximated = schedule.annotations.get("approximatedRelations") as
      | ReadonlyArray<Explanation>
      | undefined;
    expect(approximated).toBeDefined();
    expect(approximated!.length).toBe(1);
    expect(approximated![0]!.message).toMatch(/SF.*approximated/);
  });

  test("FS and SS relations do not emit approximatedRelations", async () => {
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
    const schedule = await runOnce(makeProject([t1, t2]), []);
    expect(schedule.annotations.has("approximatedRelations")).toBe(false);
  });
});

describe("serialSGS — horizon exhaustion", () => {
  test("emits Failure instead of throwing when FS lag overflows horizon", async () => {
    // Predecessor finishes near horizon end; FS edge lag pushes the
    // successor's earliestStart past the bitmap. earliestStart's
    // advanceWorkingDays must not throw — fall through to Failure.
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
          lag: Duration.from(20, TimeUnit.Days),
        },
      ],
    });
    const project = makeProject([t1, t2]);
    const resolved = resolveCalendar(project, { horizonDays: 8 });
    const generator = serialSGS.run(resolved, []);
    const first = await generator.next();
    expect(first.done).toBe(true);
    const failure = first.value as Failure | undefined;
    expect(failure).toBeDefined();
    expect(failure!.kind).toBe("failure");
  });

  test("emits Failure instead of throwing when SS lag overflows horizon", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.StartToStart,
          lag: Duration.from(30, TimeUnit.Days),
        },
      ],
    });
    const project = makeProject([t1, t2]);
    const resolved = resolveCalendar(project, { horizonDays: 8 });
    const generator = serialSGS.run(resolved, []);
    const first = await generator.next();
    expect(first.done).toBe(true);
    const failure = first.value as Failure | undefined;
    expect(failure).toBeDefined();
    expect(failure!.kind).toBe("failure");
  });

  test("emits Failure instead of throwing when FF lag overflows horizon", async () => {
    const t1 = makeTask({ uniqueId: 1, start: MON_JAN_5, finish: SAT_JAN_10 });
    const t2 = makeTask({
      uniqueId: 2,
      start: MON_JAN_5,
      finish: SAT_JAN_10,
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToFinish,
          lag: Duration.from(20, TimeUnit.Days),
        },
      ],
    });
    const project = makeProject([t1, t2]);
    const resolved = resolveCalendar(project, { horizonDays: 8 });
    const generator = serialSGS.run(resolved, []);
    const first = await generator.next();
    expect(first.done).toBe(true);
    const failure = first.value as Failure | undefined;
    expect(failure).toBeDefined();
    expect(failure!.kind).toBe("failure");
  });

  test("emits Failure instead of throwing when task can't fit before horizon", async () => {
    // Task with 4 working days at a project-end deadline — fits in the
    // horizon when standalone but not when serialized after a precedessor
    // that consumes all the working days.
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
    // Horizon = 8 days (Mon–Mon). T1 takes 5 working days, T2 needs 5 more —
    // T2 will run out of horizon. Should yield a Failure, not throw.
    const project = makeProject([t1, t2]);
    const resolved = resolveCalendar(project, { horizonDays: 8 });
    const generator = serialSGS.run(resolved, []);
    const first = await generator.next();
    expect(first.done).toBe(true);
    const failure = first.value as Failure | undefined;
    expect(failure).toBeDefined();
    expect(failure!.kind).toBe("failure");
    expect(failure!.explanations.length).toBeGreaterThan(0);
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
