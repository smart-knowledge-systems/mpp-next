// Greedy serial Schedule Generation Scheme.
// Topo-sort tasks by precedence, then for each task scan day-by-day from its
// earliest precedence-feasible start until a window opens that satisfies all
// resource caps. Single emission per call — restart/LDS/branch-and-bound are
// SearchTransformers (§2.3).

import { RelationType } from "../../model/types.ts";
import {
  advanceWorkingDays,
  countWorkingDays,
  nextWorkingDay,
  resolveWorkingCalendar,
} from "../calendarDays.ts";
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

// `mode` aligns with the MiniZinc compile contract: MaxConcurrentResource
// counts active tasks (matches `bool2int(active[t,d])`), PeakCap sums
// fractional units (matches `sum(units[t] * active[t,d])`).
interface PerResourceCap {
  readonly mode: "tasks" | "units";
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
        addCap(c.resourceUniqueId, { mode: "tasks", max: c.max, window: null });
        break;
      case "PeakCap":
        addCap(c.resourceUniqueId, {
          mode: "units",
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

// FS and SS get their exact lower bound on the successor's start. FF and SF
// constrain the successor's *finish* — the greedy pass approximates by
// subtracting durationDays calendar-day-wise from the constrained finish,
// which under-delays vs strict working-day retreat. Edges encountered in
// approximation are returned so the caller can annotate the Schedule.
function earliestStart(
  task: ResolvedTask,
  edges: ReadonlyArray<PrecedenceEdge>,
  scheduled: ReadonlyMap<number, ScheduledTask>,
  cal: WorkingCalendar,
  approximated: PrecedenceEdge[],
): number {
  let earliest = 0;
  for (const e of edges) {
    if (e.successorUniqueId !== task.uniqueId) continue;
    const pred = scheduled.get(e.predecessorUniqueId);
    if (!pred) continue;
    let candidate: number;
    switch (e.type) {
      case RelationType.FinishToStart:
        candidate = advanceWorkingDays(cal, pred.finishDay, e.lagDays);
        break;
      case RelationType.StartToStart:
        candidate = advanceWorkingDays(cal, pred.startDay, e.lagDays);
        break;
      case RelationType.FinishToFinish:
        candidate = Math.max(
          0,
          advanceWorkingDays(cal, pred.finishDay, e.lagDays) - task.durationDays,
        );
        approximated.push(e);
        break;
      case RelationType.StartToFinish:
        candidate = Math.max(
          0,
          advanceWorkingDays(cal, pred.startDay, e.lagDays) - task.durationDays,
        );
        approximated.push(e);
        break;
    }
    if (candidate > earliest) earliest = candidate;
  }
  return earliest;
}

interface DayLoad {
  units: number;
  taskIds: Set<number>;
}
type ResourceLoad = Map<number, Map<number, DayLoad>>;

function isFeasible(
  taskUniqueId: number,
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
      const dayLoad = load.get(a.resourceUniqueId)?.get(d);
      const currentUnits = dayLoad?.units ?? 0;
      const alreadyActive = dayLoad?.taskIds.has(taskUniqueId) ?? false;
      const newUnits = currentUnits + a.units;
      const newTaskCount = (dayLoad?.taskIds.size ?? 0) + (alreadyActive ? 0 : 1);
      for (const cap of resourceCaps) {
        if (cap.window && (d < cap.window.fromDay || d >= cap.window.toDay)) continue;
        if (cap.mode === "units" && newUnits > cap.max) return false;
        if (cap.mode === "tasks" && newTaskCount > cap.max) return false;
      }
    }
  }
  return true;
}

function applyLoad(
  taskUniqueId: number,
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
      let dayLoad = perResource.get(d);
      if (!dayLoad) {
        dayLoad = { units: 0, taskIds: new Set() };
        perResource.set(d, dayLoad);
      }
      dayLoad.units += a.units;
      dayLoad.taskIds.add(taskUniqueId);
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
  approximated: PrecedenceEdge[],
): PlaceResult {
  const cal = resolveWorkingCalendar(resolved, task.calendarUniqueId);
  const taskAssignments = resolved.assignments.filter((a) => a.taskUniqueId === task.uniqueId);
  const release = releases.get(task.uniqueId) ?? 0;
  const lowerBound = Math.max(release, earliestStart(task, edges, scheduled, cal, approximated));
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
    // Guard the throw in advanceWorkingDays: if there aren't enough working
    // days left in the horizon, fall through to the Failure construction
    // below rather than letting the exception escape the generator.
    if (countWorkingDays(cal, startDay, cal.horizonDays) < task.durationDays) break;
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
    if (isFeasible(task.uniqueId, startDay, finishDay, taskAssignments, cal, caps, load)) {
      applyLoad(task.uniqueId, startDay, finishDay, taskAssignments, cal, load);
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
    const approximatedEdges: PrecedenceEdge[] = [];
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
        approximatedEdges,
      );
      if (explanation) {
        placementExplanations.push(explanation);
        placementFailed = true;
      }
    }

    const approximationExplanations: Explanation[] = approximatedEdges.map((e) => ({
      violated: { kind: "Precedence", edges: [e] },
      involvedTaskIds: [e.predecessorUniqueId, e.successorUniqueId],
      atDays: null,
      message:
        `serialSGS: ${e.type === RelationType.FinishToFinish ? "FF" : "SF"} relation ` +
        `${String(e.predecessorUniqueId)}→${String(e.successorUniqueId)} approximated ` +
        `(start lower bound under-delays vs strict working-day retreat); use a CP-SAT or ` +
        `MiniZinc backend for exact semantics.`,
    }));

    if (placementFailed) {
      return {
        kind: "failure",
        explanations: [...explanations, ...approximationExplanations, ...placementExplanations],
      } satisfies Failure;
    }

    const tasks = order.map((t) => scheduled.get(t.uniqueId)!);
    let makespan = 0;
    for (const t of tasks) {
      if (t.finishDay > makespan) makespan = t.finishDay;
    }

    const annotationEntries: [string, unknown][] = [];
    if (explanations.length > 0) annotationEntries.push(["unsupportedConstraints", explanations]);
    if (approximationExplanations.length > 0) {
      annotationEntries.push(["approximatedRelations", approximationExplanations]);
    }

    yield {
      resolved,
      tasks,
      makespan,
      annotations: new Map<string, unknown>(annotationEntries),
    };
    return undefined;
  },
};

// Reserved for callers that want to inspect deadlines/releases pulled out
// during preprocessing.
export type { DeadlineConstraint, ReleaseConstraint };
