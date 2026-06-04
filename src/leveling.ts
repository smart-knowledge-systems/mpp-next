// Leveling subpath API — the resource-leveling / project-scheduling toolkit
// (`level-core` + `level-blocks`). Usage: import { ... } from "levelset/leveling";
//
// This entry pulls only `zod` (a peer dependency) and internal model/schema
// modules — none of the reader/writer dependencies (`exceljs`, `cfb`,
// `fast-xml-parser`). Importing the scheduler does not pull Excel/MPP parsing
// into your bundle.

// ── Core types & signatures ──────────────────────────────────────────
// Types only: the `declare function` spec stubs in level-core/types.ts have
// no runtime; their real implementations are re-exported from the modules
// below (resolveCalendar, materialize, dayToDate, …).
export type {
  Project,
  DayIndex,
  WorkingCalendar,
  ResolvedTask,
  ResolvedAssignment,
  ResolvedResource,
  PrecedenceEdge,
  ResolvedProject,
  WorkUnit,
  Constraint,
  PrecedenceConstraint,
  CalendarsConstraint,
  MaxConcurrentResourceConstraint,
  PeakCapConstraint,
  ConcurrentUnitsLimitConstraint,
  UnitPrecedenceConstraint,
  UnimodalProfileConstraint,
  ModeSelectionConstraint,
  TaskMode,
  CrewFlowContinuityConstraint,
  DeadlineConstraint,
  ReleaseConstraint,
  Scorer,
  Explanation,
  Failure,
  ScheduledTask,
  Schedule,
  TaskDelta,
  ResourceDayDelta,
  ScheduleDiff,
  ScheduleStream,
  Search,
  SearchTransformer,
  Stage,
  Pipeline,
  ResolveOptions,
} from "./level-core/types.ts";
export { pipe, assertNeverConstraint } from "./level-core/types.ts";

// ── Pipeline implementations ─────────────────────────────────────────
export * from "./level-core/calendarDays.ts";
export * from "./level-core/resolveCalendar.ts";
export * from "./level-core/materialize.ts";
export * from "./level-core/currentSchedule.ts";
export * from "./level-core/scheduleStream.ts";
export * from "./level-core/weeklyProfile.ts";
export { serialSGS } from "./level-core/search/serialSGS.ts";

// ── Blocks (configured constraints & scorers + MiniZinc fragments) ───
export * from "./level-blocks/types.ts";
export * from "./level-blocks/maxConcurrentResource.ts";
export * from "./level-blocks/concurrentResourceCost.ts";
export * from "./level-blocks/concurrentUnitsLimit.ts";
export * from "./level-blocks/hiringLagPenalty.ts";
export * from "./level-blocks/openUnitPenalty.ts";
export * from "./level-blocks/unimodalDeviation.ts";
