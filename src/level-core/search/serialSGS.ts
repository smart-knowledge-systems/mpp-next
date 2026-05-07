// Greedy serial Schedule Generation Scheme.
// Topo-sort tasks by precedence, then for each task scan day-by-day from its
// earliest precedence-feasible start until a window opens that satisfies all
// resource caps. Single emission per call — restart/LDS/branch-and-bound are
// SearchTransformers (§2.3).

import { RelationType } from "../../model/types.ts";
import { advanceWorkingDays, nextWorkingDay } from "../calendarDays.ts";
import {
  type Constraint,
  type DeadlineConstraint,
  type Explanation,
  type Failure,
  type PrecedenceEdge,
  type ReleaseConstraint,
  type ResolvedAssignment,
  type ResolvedProject,
  type ResolvedTask,
  type Schedule,
  type ScheduledTask,
  type Search,
  type WorkingCalendar,
  assertNeverConstraint,
} from "../types.ts";

interface PerResourceCap {
  readonly max: number;
  readonly window: { readonly fromDay: number; readonly toDay: number } | null;
}

interface Preprocessed {
  readonly edges: ReadonlyArray<PrecedenceEdge>;
  readonly caps: ReadonlyMap<number, ReadonlyArray<PerResourceCap>>;
  readonly deadlines: ReadonlyMap<number, number>;
  readonly releases: ReadonlyMap<number, number>;
  readonly explanations: ReadonlyArray<Explanation>;
}

function preprocess(
  resolved: ResolvedProject,
  constraints: ReadonlyArray<Constraint>,
): Preprocessed {
  const edges: PrecedenceEdge[] = [...resolved.precedences];
  const caps = new Map<number, PerResourceCap[]>();
  const deadlines = new Map<number, number>();
  const releases = new Map<number, number>();
  const explanations: Explanation[] = [];

  const addCap = (resourceId: number, cap: PerResourceCap): void => {
    let arr = caps.get(resourceId);
    if (!arr) {
      arr = [];
      caps.set(resourceId, arr);
    }
    arr.push(cap);
  };

  const tightenDeadline = (taskId: number, latestFinish: number): void => {
    const prev = deadlines.get(taskId);
    deadlines.set(taskId, prev === undefined ? latestFinish : Math.min(prev, latestFinish));
  };

  const loosenRelease = (taskId: number, earliestStart: number): void => {
    const prev = releases.get(taskId);
    releases.set(taskId, prev === undefined ? earliestStart : Math.max(prev, earliestStart));
  };

  for (const c of constraints) {
    switch (c.kind) {
      case "Precedence":
        edges.push(...c.edges);
        break;
      case "Calendars":
        // Already baked into resolved.calendars upstream.
        break;
      case "MaxConcurrentResource":
        addCap(c.resourceUniqueId, { max: c.max, window: null });
        break;
      case "PeakCap":
        addCap(c.resourceUniqueId, {
          max: c.cap,
          window: c.window ? { fromDay: c.window.fromDay, toDay: c.window.toDay } : null,
        });
        break;
      case "Deadline":
        tightenDeadline(c.taskUniqueId, c.latestFinish);
        break;
      case "Release":
        loosenRelease(c.taskUniqueId, c.earliestStart);
        break;
      case "LaydownSpaceCap":
      case "AdjustmentTeamCap":
      case "MultiBayPrecedence":
      case "UnimodalProfile":
      case "ModeSelection":
      case "CrewFlowContinuity":
        explanations.push({
          violated: c,
          involvedTaskIds: [],
          atDays: null,
          message: `${c.kind} is not implemented in greedy serial-SGS; constraint ignored.`,
        });
        break;
      default:
        assertNeverConstraint(c);
    }
  }

  return { edges, caps, deadlines, releases, explanations };
}

function topoSort(
  tasks: ReadonlyArray<ResolvedTask>,
  edges: ReadonlyArray<PrecedenceEdge>,
): ResolvedTask[] {
  const taskById = new Map(tasks.map((t) => [t.uniqueId, t]));
  const indegree = new Map<number, number>();
  const successors = new Map<number, number[]>();
  for (const t of tasks) {
    indegree.set(t.uniqueId, 0);
    successors.set(t.uniqueId, []);
  }
  for (const e of edges) {
    if (!taskById.has(e.successorUniqueId) || !taskById.has(e.predecessorUniqueId)) continue;
    indegree.set(e.successorUniqueId, (indegree.get(e.successorUniqueId) ?? 0) + 1);
    successors.get(e.predecessorUniqueId)!.push(e.successorUniqueId);
  }

  const queue: number[] = [];
  for (const t of tasks) {
    if ((indegree.get(t.uniqueId) ?? 0) === 0) queue.push(t.uniqueId);
  }

  const result: ResolvedTask[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => {
      const ta = taskById.get(a)!;
      const tb = taskById.get(b)!;
      const oa = ta.outlineLevel ?? 0;
      const ob = tb.outlineLevel ?? 0;
      if (oa !== ob) return oa - ob;
      return a - b;
    });
    const id = queue.shift()!;
    const t = taskById.get(id)!;
    result.push(t);
    for (const s of successors.get(id) ?? []) {
      const next = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, next);
      if (next === 0) queue.push(s);
    }
  }
  if (result.length !== tasks.length) {
    throw new Error("serialSGS: precedence graph has a cycle");
  }
  return result;
}

function calendarFor(resolved: ResolvedProject, task: ResolvedTask): WorkingCalendar {
  const id = task.calendarUniqueId ?? resolved.defaultCalendarUniqueId;
  if (id !== null) {
    const cal = resolved.calendars.get(id);
    if (cal) return cal;
  }
  const fallback = resolved.calendars.values().next().value;
  if (!fallback) {
    throw new Error("serialSGS: ResolvedProject has no calendars");
  }
  return fallback;
}

// FF/SF treated as FS in the greedy pass; explanation emitted by the caller.
function earliestStart(
  task: ResolvedTask,
  edges: ReadonlyArray<PrecedenceEdge>,
  scheduled: ReadonlyMap<number, ScheduledTask>,
  cal: WorkingCalendar,
): number {
  let earliest = 0;
  for (const e of edges) {
    if (e.successorUniqueId !== task.uniqueId) continue;
    const pred = scheduled.get(e.predecessorUniqueId);
    if (!pred) continue;
    let candidate: number;
    switch (e.type) {
      case RelationType.FinishToStart:
      case RelationType.FinishToFinish:
      case RelationType.StartToFinish:
        candidate = advanceWorkingDays(cal, pred.finishDay, e.lagDays);
        break;
      case RelationType.StartToStart:
        candidate = advanceWorkingDays(cal, pred.startDay, e.lagDays);
        break;
    }
    if (candidate > earliest) earliest = candidate;
  }
  return earliest;
}

type ResourceLoad = Map<number, Map<number, number>>;

function isFeasible(
  startDay: number,
  finishDay: number,
  taskAssignments: ReadonlyArray<ResolvedAssignment>,
  cal: WorkingCalendar,
  caps: ReadonlyMap<number, ReadonlyArray<PerResourceCap>>,
  load: ResourceLoad,
): boolean {
  for (let d = startDay; d < finishDay; d++) {
    if (cal.bits[d] !== 1) continue;
    for (const a of taskAssignments) {
      const resourceCaps = caps.get(a.resourceUniqueId);
      if (!resourceCaps) continue;
      const currentLoad = load.get(a.resourceUniqueId)?.get(d) ?? 0;
      const newLoad = currentLoad + a.units;
      for (const cap of resourceCaps) {
        if (cap.window && (d < cap.window.fromDay || d >= cap.window.toDay)) continue;
        if (newLoad > cap.max) return false;
      }
    }
  }
  return true;
}

function applyLoad(
  startDay: number,
  finishDay: number,
  taskAssignments: ReadonlyArray<ResolvedAssignment>,
  cal: WorkingCalendar,
  load: ResourceLoad,
): void {
  for (let d = startDay; d < finishDay; d++) {
    if (cal.bits[d] !== 1) continue;
    for (const a of taskAssignments) {
      let perResource = load.get(a.resourceUniqueId);
      if (!perResource) {
        perResource = new Map();
        load.set(a.resourceUniqueId, perResource);
      }
      perResource.set(d, (perResource.get(d) ?? 0) + a.units);
    }
  }
}

interface PlaceResult {
  readonly explanation: Explanation | null;
}

function placeTask(
  task: ResolvedTask,
  edges: ReadonlyArray<PrecedenceEdge>,
  scheduled: Map<number, ScheduledTask>,
  resolved: ResolvedProject,
  caps: ReadonlyMap<number, ReadonlyArray<PerResourceCap>>,
  deadlines: ReadonlyMap<number, number>,
  releases: ReadonlyMap<number, number>,
  load: ResourceLoad,
): PlaceResult {
  const cal = calendarFor(resolved, task);
  const taskAssignments = resolved.assignments.filter((a) => a.taskUniqueId === task.uniqueId);
  const release = releases.get(task.uniqueId) ?? 0;
  const lowerBound = Math.max(release, earliestStart(task, edges, scheduled, cal));
  const deadline = deadlines.get(task.uniqueId) ?? null;

  if (task.milestone || task.durationDays === 0) {
    if (deadline !== null && lowerBound > deadline) {
      return {
        explanation: {
          violated: { kind: "Deadline", taskUniqueId: task.uniqueId, latestFinish: deadline },
          involvedTaskIds: [task.uniqueId],
          atDays: { fromDay: lowerBound, toDay: lowerBound },
          message: `Deadline ${String(deadline)} violated by milestone ${String(task.uniqueId)} earliest start ${String(lowerBound)}`,
        },
      };
    }
    scheduled.set(task.uniqueId, {
      uniqueId: task.uniqueId,
      startDay: lowerBound,
      finishDay: lowerBound,
      modeId: null,
    });
    return { explanation: null };
  }

  for (let candidate = lowerBound; candidate < cal.horizonDays; candidate++) {
    const startDay = nextWorkingDay(cal, candidate);
    if (startDay >= cal.horizonDays) break;
    const finishDay = advanceWorkingDays(cal, startDay, task.durationDays);
    if (deadline !== null && finishDay > deadline) {
      return {
        explanation: {
          violated: { kind: "Deadline", taskUniqueId: task.uniqueId, latestFinish: deadline },
          involvedTaskIds: [task.uniqueId],
          atDays: { fromDay: startDay, toDay: finishDay },
          message: `Deadline ${String(deadline)} violated: task ${String(task.uniqueId)} earliest feasible finish is ${String(finishDay)}`,
        },
      };
    }
    if (isFeasible(startDay, finishDay, taskAssignments, cal, caps, load)) {
      applyLoad(startDay, finishDay, taskAssignments, cal, load);
      scheduled.set(task.uniqueId, {
        uniqueId: task.uniqueId,
        startDay,
        finishDay,
        modeId: null,
      });
      return { explanation: null };
    }
    // Skip past the working day we just tried to avoid quadratic re-scan.
    candidate = startDay;
  }

  // Couldn't place — record the failure with a typed Precedence violation
  // (the proximate cause is the precedence lower bound + cap conflict).
  return {
    explanation: {
      violated: { kind: "Precedence", edges: [] },
      involvedTaskIds: [task.uniqueId],
      atDays: { fromDay: lowerBound, toDay: cal.horizonDays },
      message: `serialSGS: ran out of horizon placing task ${String(task.uniqueId)}`,
    },
  };
}

export const serialSGS: Search = {
  name: "serial-SGS",
  async *run(
    resolved: ResolvedProject,
    constraints: ReadonlyArray<Constraint>,
  ): AsyncGenerator<Schedule, Failure | undefined> {
    const { edges, caps, deadlines, releases, explanations } = preprocess(resolved, constraints);
    const order = topoSort(resolved.tasks, edges);
    const scheduled = new Map<number, ScheduledTask>();
    const load: ResourceLoad = new Map();
    const placementExplanations: Explanation[] = [];
    let placementFailed = false;

    for (const task of order) {
      const { explanation } = placeTask(
        task,
        edges,
        scheduled,
        resolved,
        caps,
        deadlines,
        releases,
        load,
      );
      if (explanation) {
        placementExplanations.push(explanation);
        placementFailed = true;
      }
    }

    if (placementFailed) {
      return {
        kind: "failure",
        explanations: [...explanations, ...placementExplanations],
      } satisfies Failure;
    }

    const tasks = order.map((t) => scheduled.get(t.uniqueId)!);
    let makespan = 0;
    for (const t of tasks) {
      if (t.finishDay > makespan) makespan = t.finishDay;
    }

    yield {
      resolved,
      tasks,
      makespan,
      annotations: new Map<string, unknown>(
        explanations.length > 0 ? [["unsupportedConstraints", explanations]] : [],
      ),
    };
    return undefined;
  },
};

// Reserved for callers that want to inspect deadlines/releases pulled out
// during preprocessing.
export type { DeadlineConstraint, ReleaseConstraint };
