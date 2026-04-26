// Sketch — Constraint ADT and ScheduleStream interface for `@mpp-next/level-core`.
// Tracks docs/dev-log/leveling-toolkit-spec-v3.md. Section refs in-line as §X.Y.

import type { ZodType } from "zod";

import type { ProjectFile as Project } from "../model/Project.ts";
import type { RelationType } from "../model/types.ts";

// ─────────────────────────────────────────────────────────────────
// Day-indexed working time (R4 / §2.4)
// ─────────────────────────────────────────────────────────────────

export type WorkingDayBitmap = ReadonlyArray<boolean>;

export interface CalendarResolution {
  readonly origin: Date;
  readonly bitmap: WorkingDayBitmap;
  readonly calendarUniqueId: number | null;
}

// ─────────────────────────────────────────────────────────────────
// ResolvedProject (R4 / §2.4) — the working value during the
// pipeline. Hot-loop stages must never see Date objects. The
// `source` reference lets `materialize` carry forward fields the
// toolkit doesn't touch (notes, baselines, custom fields).
// ─────────────────────────────────────────────────────────────────

export interface ResolvedTask {
  readonly uniqueId: number;
  readonly name: string | null;
  readonly startDay: number;
  readonly finishDay: number;
  readonly durationDays: number;
  readonly outlineLevel: number | null;
  readonly summary: boolean;
  readonly milestone: boolean;
}

export interface ResolvedAssignment {
  readonly taskUniqueId: number;
  readonly resourceUniqueId: number;
  readonly units: number;
}

export interface PrecedenceEdge {
  readonly predecessorUniqueId: number;
  readonly successorUniqueId: number;
  readonly type: RelationType;
  readonly lagDays: number;
}

export interface ResolvedProject {
  readonly source: Project;
  readonly calendar: CalendarResolution;
  readonly tasks: ReadonlyArray<ResolvedTask>;
  readonly assignments: ReadonlyArray<ResolvedAssignment>;
  readonly precedences: ReadonlyArray<PrecedenceEdge>;
}

// ─────────────────────────────────────────────────────────────────
// Constraint ADT (§2.2 / §4.2)
//
// Constraint as data, not opaque function — later stages can
// inspect, rewrite, and explain. Discriminated union; v1 blocks
// listed in §11; ModeSelection is v2 (refinement #5) but included
// here so the ADT shape doesn't churn.
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
  | ModeSelectionConstraint;

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
  readonly window?: { readonly fromDay: number; readonly toDay: number };
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

// R3: shape constraint, separate from Smoothness (which is a moment scorer).
// A moment minimizer will happily oscillate around a smooth mean — exactly
// what the v3 OHT script forbids.
export interface UnimodalProfileConstraint {
  readonly kind: "UnimodalProfile";
  readonly resourceUniqueId: number;
  readonly tolerance: number;
  readonly allowSecondPeak?: boolean;
}

// v2 (refinement #5). Multi-mode RCPSP — the v3 OHT script's central lever.
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

// Exhaustiveness helper. Forces a compile error if a new Constraint
// variant is added without updating downstream switches.
export function assertNeverConstraint(c: never): never {
  throw new Error(`unhandled Constraint variant: ${JSON.stringify(c)}`);
}

// ─────────────────────────────────────────────────────────────────
// Explanations (§2.2)
//
// First-class even though v1 has no conflict learning — surfacing
// *why* a partial schedule is infeasible is essential for the LCNC
// and LLM pillars (Pillars 3, 4).
// ─────────────────────────────────────────────────────────────────

export interface Explanation {
  readonly violated: Constraint;
  readonly involvedTaskIds: ReadonlyArray<number>;
  readonly atDay: number | null;
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────
// Schedule
// ─────────────────────────────────────────────────────────────────

export interface ScheduledTask {
  readonly uniqueId: number;
  readonly startDay: number;
  readonly finishDay: number;
  readonly modeId: number | null;
}

export interface Schedule {
  readonly resolved: ResolvedProject;
  readonly tasks: ReadonlyArray<ScheduledTask>;
  readonly explanations: ReadonlyArray<Explanation>;
}

// ─────────────────────────────────────────────────────────────────
// Scoring (§4.2)
// ─────────────────────────────────────────────────────────────────

export interface Scorer<T = number> {
  readonly name: string;
  readonly direction: "min" | "max";
  score(schedule: Schedule): T;
}

// ─────────────────────────────────────────────────────────────────
// ScheduleStream (Pillar 2 / §3.2)
//
// Lazy iterable of feasible schedules. Implemented over async
// generators so it composes whether the backend is the in-process
// greedy engine, MiniZinc, or remote CP-SAT. Default to lazy:
// `bestBy` and `paretoFrontier` materialize; `take`, `filter`,
// `map`, `branch` stay lazy.
// ─────────────────────────────────────────────────────────────────

export interface ScheduleStream {
  [Symbol.asyncIterator](): AsyncIterator<Schedule>;

  filter(pred: (s: Schedule) => boolean): ScheduleStream;
  map(fn: (s: Schedule) => Schedule): ScheduleStream;
  take(k: number): ScheduleStream;
  branch(fork: (s: Schedule) => ScheduleStream): ScheduleStream;

  bestBy(scorer: Scorer): Promise<Schedule | null>;
  paretoFrontier(scorers: ReadonlyArray<Scorer>): Promise<ReadonlyArray<Schedule>>;

  // Bounded materialization — caller asserts the stream terminates.
  collect(limit?: number): Promise<ReadonlyArray<Schedule>>;
}

// ─────────────────────────────────────────────────────────────────
// Schedule diff (§3.2 — primitive for "branch, score, pick")
// ─────────────────────────────────────────────────────────────────

export interface TaskDelta {
  readonly uniqueId: number;
  readonly startDelta: number;
  readonly finishDelta: number;
  readonly modeChange: { readonly from: number | null; readonly to: number | null } | null;
}

export interface ResourceDayDelta {
  readonly resourceUniqueId: number;
  readonly day: number;
  readonly delta: number;
}

export interface ScheduleDiff {
  readonly tasks: ReadonlyArray<TaskDelta>;
  readonly resourceDays: ReadonlyArray<ResourceDayDelta>;
  readonly criticalPathChanged: boolean;
}

export declare function diffSchedules(a: Schedule, b: Schedule): ScheduleDiff;

// ─────────────────────────────────────────────────────────────────
// Search (MCP shape per §2.3, R2)
//
// v1 ships the *interface* with a single greedy serial-SGS strategy
// behind it. v2 adds branch-and-bound, LDS, restart, LNS as
// `SearchTransformer`s wrapping this interface — Schrijvers/Stuckey/
// Wadler in spirit, generator-encoded for TS.
// ─────────────────────────────────────────────────────────────────

export interface Search {
  readonly name: string;
  run(resolved: ResolvedProject, constraints: ReadonlyArray<Constraint>): AsyncGenerator<Schedule>;
}

export type SearchTransformer = (inner: Search) => Search;

// ─────────────────────────────────────────────────────────────────
// Pipeline (§4.2)
//
// A pipeline is a sequence of pure transformations on
// `ResolvedProject`, terminating in a `Search` that emits a
// `ScheduleStream`. Pipelines are serializable JSON values — the
// LCNC editor (Pillar 3) and the LLM agent (Pillar 4) both write
// pipelines, never raw search code.
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
// Block (Pillar 3 / §4.2)
//
// A Block is the LCNC unit. Four parts:
//   - apply       : produce Constraints for the in-process Search.
//   - toMiniZinc  : emit a fragment for the R1 MZN compile target.
//   - schema      : Zod schema for params (LCNC validation, JSON edits).
//   - doc         : human-readable description for the palette/agent.
// MiniZincContext is provisional — names ("DAYS", "active[t,d]") are
// hardcoded conventions in v1 and will move into context once the MZN
// compiler stage lands.
// ─────────────────────────────────────────────────────────────────

export interface MiniZincContext {
  readonly tasksDemanding: (resourceUniqueId: number) => ReadonlyArray<number>;
}

export interface Block<P> {
  readonly name: string;
  readonly schema: ZodType<P>;
  readonly doc: string;
  apply(project: ResolvedProject, params: P): ReadonlyArray<Constraint>;
  toMiniZinc(params: P, ctx: MiniZincContext): string;
}

// ─────────────────────────────────────────────────────────────────
// Top-level entry points (§9.2)
//
// Project ──resolveCalendar──> ResolvedProject ──[stages]──>
//   Schedule ──materialize──> Project
//
// Implementations live in sibling modules:
//   resolveCalendar — ./resolveCalendar.ts
//   materialize     — ./materialize.ts
//   run             — ./run.ts
// ─────────────────────────────────────────────────────────────────
