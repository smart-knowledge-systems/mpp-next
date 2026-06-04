// Types & signatures for @levelset/level-core.
// Tracks docs/dev-log/leveling-toolkit-spec-v4.md (§ refs in-line).

import type { ProjectFile as Project } from "../model/Project.ts";
import type { Calendar } from "../model/Calendar.ts";
import type { RelationType } from "../model/types.ts";

export type { Project };

// ─────────────────────────────────────────────────────────────────
// Day-indexed working time (R4 / §2.4 / S5)
//
// Bitmap is Uint8Array (1 byte/day vs ~9 for boolean[]) and carries a
// precomputed prefix sum so "working days between A and B" is O(1) — the
// dominant query in the OHT script. `readonly` is by convention here;
// stages must not mutate.
// ─────────────────────────────────────────────────────────────────

export type DayIndex = number;

export interface WorkingCalendar {
  readonly calendarUniqueId: number | null;
  readonly epoch: Date;
  readonly horizonDays: number;
  readonly bits: Uint8Array; // 1 = working day, 0 = nonworking
  readonly cumWorking: Int32Array; // cumWorking[i] = sum(bits[0..i])
}

// ─────────────────────────────────────────────────────────────────
// ResolvedProject (R4 / §2.4)
//
// Resolved *structure*, not scheduling state (S1). ScheduledTask carries
// startDay/finishDay; ResolvedTask intentionally does not. CPM bounds, if
// computed, ride on a separate annotation produced by an explicit stage —
// keeps "post-resolve" and "post-CPM" non-overlapping.
//
// `calendars` is a Map (D4) so per-task and per-resource calendar overrides
// (N1) are first-class. Tasks/resources without an override fall back to
// `defaultCalendarUniqueId`.
// ─────────────────────────────────────────────────────────────────

export interface ResolvedTask {
  readonly uniqueId: number;
  readonly name: string | null;
  readonly durationDays: number;
  readonly outlineLevel: number | null;
  readonly summary: boolean;
  readonly milestone: boolean;
  /** Override calendar for this task; falls back to default when null. */
  readonly calendarUniqueId: number | null;
}

export interface ResolvedAssignment {
  readonly taskUniqueId: number;
  readonly resourceUniqueId: number;
  readonly units: number;
}

export interface ResolvedResource {
  readonly uniqueId: number;
  /** D2: (resource.maxUnits ?? 1) * (properties.minutesPerDay / 60). */
  readonly capacityPerDay: number;
  /** Override calendar for this resource; falls back to default when null. */
  readonly calendarUniqueId: number | null;
}

export interface PrecedenceEdge {
  readonly predecessorUniqueId: number;
  readonly successorUniqueId: number;
  readonly type: RelationType;
  readonly lagDays: number;
}

export interface ResolvedProject {
  readonly source: Project;
  readonly defaultCalendarUniqueId: number | null;
  readonly calendars: ReadonlyMap<number, WorkingCalendar>;
  readonly tasks: ReadonlyArray<ResolvedTask>;
  readonly resources: ReadonlyArray<ResolvedResource>;
  readonly assignments: ReadonlyArray<ResolvedAssignment>;
  readonly precedences: ReadonlyArray<PrecedenceEdge>;
}

// ─────────────────────────────────────────────────────────────────
// Constraint ADT (§4.2 / §4.3)
//
// Discriminated union; matches the v4 block roster in §4.3. The ADT is the
// *interchange format* between blocks and the search; blocks emit constraint
// variants, the search consumes them.
// ─────────────────────────────────────────────────────────────────

export type Constraint =
  | PrecedenceConstraint
  | CalendarsConstraint
  | MaxConcurrentResourceConstraint
  | PeakCapConstraint
  | LaydownSpaceCapConstraint
  | AdjustmentTeamCapConstraint
  | MultiBayPrecedenceConstraint
  | UnimodalProfileConstraint
  | ModeSelectionConstraint
  | CrewFlowContinuityConstraint
  | DeadlineConstraint
  | ReleaseConstraint;

export interface PrecedenceConstraint {
  readonly kind: "Precedence";
  readonly edges: ReadonlyArray<PrecedenceEdge>;
}

export interface CalendarsConstraint {
  readonly kind: "Calendars";
  readonly calendarUniqueId: number;
}

export interface MaxConcurrentResourceConstraint {
  readonly kind: "MaxConcurrentResource";
  readonly resourceUniqueId: number;
  readonly max: number;
}

export interface PeakCapConstraint {
  readonly kind: "PeakCap";
  readonly resourceUniqueId: number;
  readonly cap: number;
  readonly window?: { readonly fromDay: DayIndex; readonly toDay: DayIndex };
}

export interface LaydownSpaceCapConstraint {
  readonly kind: "LaydownSpaceCap";
  readonly bayGroup: ReadonlyArray<number>;
  readonly maxConcurrent: number;
}

export interface AdjustmentTeamCapConstraint {
  readonly kind: "AdjustmentTeamCap";
  readonly resourceUniqueId: number;
  readonly maxTeams: number;
}

export interface MultiBayPrecedenceConstraint {
  readonly kind: "MultiBayPrecedence";
  readonly bayId: number;
  readonly afterBayIds: ReadonlyArray<number>;
}

// R3: shape constraint, separate from the Smoothness *scorer*. A moment
// minimizer will happily oscillate around a smooth mean — exactly what
// the OHT install forbids.
export interface UnimodalProfileConstraint {
  readonly kind: "UnimodalProfile";
  readonly resourceUniqueId: number;
  readonly tolerance: number;
  readonly allowSecondPeak?: boolean;
}

// Multi-mode RCPSP — the OHT script's central mode lever.
export interface ModeSelectionConstraint {
  readonly kind: "ModeSelection";
  readonly taskUniqueId: number;
  readonly modes: ReadonlyArray<TaskMode>;
}

export interface TaskMode {
  readonly modeId: number;
  readonly durationDays: number;
  readonly resourceDemand: ReadonlyArray<{
    readonly resourceUniqueId: number;
    readonly units: number;
  }>;
}

// N5: LBMS-flavored — keeps a crew working a sequence of locations without
// idle gaps. The empirical premise of LBMS is that crew flow continuity
// matters more than per-task makespan.
export interface CrewFlowContinuityConstraint {
  readonly kind: "CrewFlowContinuity";
  readonly resourceUniqueId: number;
  readonly locationOrder: ReadonlyArray<number>;
}

export interface DeadlineConstraint {
  readonly kind: "Deadline";
  readonly taskUniqueId: number;
  readonly latestFinish: DayIndex;
}

export interface ReleaseConstraint {
  readonly kind: "Release";
  readonly taskUniqueId: number;
  readonly earliestStart: DayIndex;
}

/** Forces a compile error if a new Constraint variant is added but a
 *  switch downstream isn't updated. */
export function assertNeverConstraint(c: never): never {
  throw new Error(`unhandled Constraint variant: ${JSON.stringify(c)}`);
}

// ─────────────────────────────────────────────────────────────────
// Scoring (§4.2)
//
// R3: Smoothness (Burgess–Killebrew sum-of-squares moment) and the
// UnimodalDeviation companion to UnimodalProfile both live here as
// Scorer instances, not Constraint variants.
// ─────────────────────────────────────────────────────────────────

export interface Scorer<T = number> {
  readonly name: string;
  readonly direction: "min" | "max";
  score(schedule: Schedule): T;
}

// ─────────────────────────────────────────────────────────────────
// Failure & explanations (§2.2 / S2)
//
// Explanations describe *why* a search step rejected a partial schedule.
// They belong on Failure, not on Schedule — a feasible schedule has no
// violations to explain. Search yields Schedules and may return a
// Failure on exhaustion.
// ─────────────────────────────────────────────────────────────────

export interface Explanation {
  readonly violated: Constraint;
  readonly involvedTaskIds: ReadonlyArray<number>;
  readonly atDays: { readonly fromDay: DayIndex; readonly toDay: DayIndex } | null;
  readonly message: string;
}

export interface Failure {
  readonly kind: "failure";
  readonly explanations: ReadonlyArray<Explanation>;
}

// ─────────────────────────────────────────────────────────────────
// Schedule
// ─────────────────────────────────────────────────────────────────

export interface ScheduledTask {
  readonly uniqueId: number;
  readonly startDay: DayIndex;
  readonly finishDay: DayIndex;
  readonly modeId: number | null; // null until ModeSelection lands
}

export interface Schedule {
  readonly resolved: ResolvedProject;
  readonly tasks: ReadonlyArray<ScheduledTask>;
  readonly makespan: DayIndex;
  /** Per-block annotations (scores, telemetry). Not for violations. */
  readonly annotations: ReadonlyMap<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────
// ScheduleDiff (§3.2 — primitive for "branch, score, pick")
// ─────────────────────────────────────────────────────────────────

export interface TaskDelta {
  readonly uniqueId: number;
  readonly startDelta: number;
  readonly finishDelta: number;
  readonly modeChange: { readonly from: number | null; readonly to: number | null } | null;
}

export interface ResourceDayDelta {
  readonly resourceUniqueId: number;
  readonly day: DayIndex;
  readonly delta: number;
}

export interface ScheduleDiff {
  readonly tasks: ReadonlyArray<TaskDelta>;
  readonly resourceDays: ReadonlyArray<ResourceDayDelta>;
  /** Computed lazily — non-trivial CPM rerun. */
  readonly criticalPathChanged: boolean;
}

export declare function diffSchedules(a: Schedule, b: Schedule): ScheduleDiff;

// ─────────────────────────────────────────────────────────────────
// ScheduleStream (Pillar 2 / §3.2)
//
// Lazy iterable of feasible Schedules. Async generators inside; uniform
// interface across in-process greedy, MiniZinc subprocess, and remote
// CP-SAT. Default to lazy: bestBy / paretoFrontier materialize; the rest
// stay lazy. Search exhaustion surfaces as a Failure via the Search
// generator's return value, not via the stream — the stream just ends.
// ─────────────────────────────────────────────────────────────────

export interface ScheduleStream {
  [Symbol.asyncIterator](): AsyncIterator<Schedule>;

  filter(pred: (s: Schedule) => boolean): ScheduleStream;
  map(fn: (s: Schedule) => Schedule): ScheduleStream;
  take(k: number): ScheduleStream;
  branch(fork: (s: Schedule) => ScheduleStream): ScheduleStream;

  bestBy(scorer: Scorer): Promise<Schedule | null>;
  paretoFrontier(scorers: ReadonlyArray<Scorer>): Promise<ReadonlyArray<Schedule>>;
  /** Bounded materialization — caller asserts the stream terminates. */
  collect(limit?: number): Promise<ReadonlyArray<Schedule>>;
}

// ─────────────────────────────────────────────────────────────────
// Search (MCP shape per §2.3, R2)
//
// Transformers (BB, LDS, restart, LNS) wrap a Search to produce a
// Search — Schrijvers/Stuckey/Wadler in spirit. The generator returns a
// Failure on exhaustion when no feasible schedule exists.
// ─────────────────────────────────────────────────────────────────

export interface Search {
  readonly name: string;
  run(
    resolved: ResolvedProject,
    constraints: ReadonlyArray<Constraint>,
  ): AsyncGenerator<Schedule, Failure | undefined>;
}

export type SearchTransformer = (inner: Search) => Search;

// ─────────────────────────────────────────────────────────────────
// Pipeline (§4.2 / S4 / D6)
//
// Two layers, easy to confuse:
//
//   • Pipeline-as-data — the `Block[]` + port wiring sense. JSON-
//     serializable. Lives in @levelset/level-blocks. The LCNC editor
//     and the LLM agent emit this; the compiler accepts it.
//   • Pipeline-as-function (this file) — the *compiled* form. `Stage`
//     is a function, not data; `pipe` composes them. Compilation
//     produces this from Pipeline-as-data.
//
// The serialization promise is on Pipeline-as-data alone.
// ─────────────────────────────────────────────────────────────────

export type Stage = (resolved: ResolvedProject) => ResolvedProject;

export interface Pipeline {
  readonly stages: ReadonlyArray<Stage>;
  readonly constraints: ReadonlyArray<Constraint>;
  readonly search: Search;
}

export function pipe(...stages: Stage[]): Stage {
  return (project) => stages.reduce((p, s) => s(p), project);
}

// ─────────────────────────────────────────────────────────────────
// Top-level entry points (§9.2)
//
//   Project ──resolveCalendar──> ResolvedProject ──run(pipeline)──>
//     ScheduleStream ──pick──> Schedule ──materialize──> Project
//
// Round-trip fidelity invariant (test required, R4): for every working
// day `d` in the resolved horizon and every WorkingCalendar in the map,
// `dateToDay(cal, dayToDate(cal, d)) === d`.
// ─────────────────────────────────────────────────────────────────

export interface ResolveOptions {
  /** D1: opts.epoch ?? properties.statusDate ?? min(task.start). Throws if none. */
  readonly epoch?: Date;
  /** Default = ceil(span(project) * 1.25), bounded by 10 years. */
  readonly horizonDays?: number;
}

export declare function resolveCalendar(project: Project, opts?: ResolveOptions): ResolvedProject;

/** D3: bridge for the no-search-yet case. Reads pre-existing dates from
 *  `resolved.source` into Schedule shape so round-trip identity holds. */
export declare function currentSchedule(resolved: ResolvedProject): Schedule;

export declare function materialize(schedule: Schedule): Project;

export declare function run(pipeline: Pipeline, project: Project): ScheduleStream;

export declare function buildWorkingCalendar(
  cal: Calendar | null,
  calendarUniqueId: number | null,
  epoch: Date,
  horizonDays: number,
): WorkingCalendar;

export declare function dayToDate(cal: WorkingCalendar, day: DayIndex): Date;
export declare function dateToDay(cal: WorkingCalendar, date: Date): DayIndex;
