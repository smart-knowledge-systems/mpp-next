// Greedy serial Schedule Generation Scheme (§11 v1 #2).
// Topo-sort tasks by precedence, then for each task scan day-by-day from its
// earliest precedence-feasible start until a window opens that satisfies all
// resource caps. Single emission per call — restart/LDS/branch-and-bound are
// SearchTransformers in v2.

import { RelationType } from "../../model/types.ts";
import { advanceWorkingDays } from "../calendarDays.ts";
import {
  type Constraint,
  type Explanation,
  type PrecedenceEdge,
  type ResolvedAssignment,
  type ResolvedProject,
  type ResolvedTask,
  type Schedule,
  type ScheduledTask,
  type Search,
  assertNeverConstraint,
} from "../types.ts";

interface PerResourceCap {
  readonly max: number;
  readonly window: { readonly fromDay: number; readonly toDay: number } | null;
}

interface Preprocessed {
  readonly edges: ReadonlyArray<PrecedenceEdge>;
  readonly caps: ReadonlyMap<number, ReadonlyArray<PerResourceCap>>;
  readonly explanations: ReadonlyArray<Explanation>;
}

function preprocess(
  resolved: ResolvedProject,
  constraints: ReadonlyArray<Constraint>,
): Preprocessed {
  const edges: PrecedenceEdge[] = [...resolved.precedences];
  const caps = new Map<number, PerResourceCap[]>();
  const explanations: Explanation[] = [];

  const addCap = (resourceId: number, cap: PerResourceCap): void => {
    let arr = caps.get(resourceId);
    if (!arr) {
      arr = [];
      caps.set(resourceId, arr);
    }
    arr.push(cap);
  };

  for (const c of constraints) {
    switch (c.kind) {
      case "Precedence":
        edges.push(...c.edges);
        break;
      case "Calendars":
        // Already baked into resolved.calendar.bitmap upstream.
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
      case "LaydownSpaceCap":
      case "AdjustmentTeamCap":
      case "MultiBayPrecedence":
      case "UnimodalProfile":
      case "ModeSelection":
        explanations.push({
          violated: c,
          involvedTaskIds: [],
          atDay: null,
          message: `${c.kind} is not implemented in greedy serial-SGS v1; constraint ignored.`,
        });
        break;
      default:
        assertNeverConstraint(c);
    }
  }

  return { edges, caps, explanations };
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

function nextWorkingDay(bitmap: ReadonlyArray<boolean>, day: number): number {
  let d = day;
  while (d < bitmap.length && !bitmap[d]) d++;
  return d;
}

// FF/SF treated as FS in v1; explanation is emitted by the caller.
function earliestStart(
  task: ResolvedTask,
  edges: ReadonlyArray<PrecedenceEdge>,
  scheduled: ReadonlyMap<number, ScheduledTask>,
  bitmap: ReadonlyArray<boolean>,
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
        candidate = advanceWorkingDays(bitmap, pred.finishDay, e.lagDays);
        break;
      case RelationType.StartToStart:
        candidate = advanceWorkingDays(bitmap, pred.startDay, e.lagDays);
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
  bitmap: ReadonlyArray<boolean>,
  caps: ReadonlyMap<number, ReadonlyArray<PerResourceCap>>,
  load: ResourceLoad,
): boolean {
  for (let d = startDay; d < finishDay; d++) {
    if (!bitmap[d]) continue;
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
  bitmap: ReadonlyArray<boolean>,
  load: ResourceLoad,
): void {
  for (let d = startDay; d < finishDay; d++) {
    if (!bitmap[d]) continue;
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

function placeTask(
  task: ResolvedTask,
  edges: ReadonlyArray<PrecedenceEdge>,
  scheduled: Map<number, ScheduledTask>,
  resolved: ResolvedProject,
  caps: ReadonlyMap<number, ReadonlyArray<PerResourceCap>>,
  load: ResourceLoad,
  explanations: Explanation[],
): void {
  const bitmap = resolved.calendar.bitmap;
  const taskAssignments = resolved.assignments.filter((a) => a.taskUniqueId === task.uniqueId);
  const lowerBound = earliestStart(task, edges, scheduled, bitmap);

  if (task.milestone || task.durationDays === 0) {
    scheduled.set(task.uniqueId, {
      uniqueId: task.uniqueId,
      startDay: lowerBound,
      finishDay: lowerBound,
      modeId: null,
    });
    return;
  }

  for (let candidate = lowerBound; candidate < bitmap.length; candidate++) {
    const startDay = nextWorkingDay(bitmap, candidate);
    if (startDay >= bitmap.length) break;
    const finishDay = advanceWorkingDays(bitmap, startDay, task.durationDays);
    if (isFeasible(startDay, finishDay, taskAssignments, bitmap, caps, load)) {
      applyLoad(startDay, finishDay, taskAssignments, bitmap, load);
      scheduled.set(task.uniqueId, {
        uniqueId: task.uniqueId,
        startDay,
        finishDay,
        modeId: null,
      });
      return;
    }
    // Skip past the working day we just tried to avoid quadratic re-scan.
    candidate = startDay;
  }

  // Couldn't place — record the failure but still emit a partial schedule
  // with the task pinned at the precedence lower bound so callers can see
  // what was infeasible.
  explanations.push({
    violated: { kind: "Precedence", edges: [] },
    involvedTaskIds: [task.uniqueId],
    atDay: lowerBound,
    message: `serialSGS: ran out of horizon placing task ${String(task.uniqueId)}`,
  });
  scheduled.set(task.uniqueId, {
    uniqueId: task.uniqueId,
    startDay: lowerBound,
    finishDay: lowerBound + task.durationDays,
    modeId: null,
  });
}

export const serialSGS: Search = {
  name: "serial-SGS",
  async *run(
    resolved: ResolvedProject,
    constraints: ReadonlyArray<Constraint>,
  ): AsyncGenerator<Schedule> {
    const { edges, caps, explanations } = preprocess(resolved, constraints);
    const order = topoSort(resolved.tasks, edges);
    const scheduled = new Map<number, ScheduledTask>();
    const load: ResourceLoad = new Map();
    const runtimeExplanations: Explanation[] = [];

    for (const task of order) {
      placeTask(task, edges, scheduled, resolved, caps, load, runtimeExplanations);
    }

    yield {
      resolved,
      tasks: order.map((t) => scheduled.get(t.uniqueId)!),
      explanations: [...explanations, ...runtimeExplanations],
    };
  },
};
