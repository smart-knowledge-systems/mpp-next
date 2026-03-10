import type { Duration } from "./Duration.ts";
import type { Relation } from "./Relation.ts";
import type { ConstraintType } from "./types.ts";

export interface Task {
  id: number | null;
  uniqueId: number | null;
  name: string | null;
  wbs: string | null;
  outlineLevel: number | null;
  start: Date | null;
  finish: Date | null;
  duration: Duration | null;
  percentComplete: number | null;
  summary: boolean | null;
  milestone: boolean | null;
  critical: boolean | null;
  notes: string | null;
  priority: number | null;
  cost: number | null;
  work: Duration | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  baselineDuration: Duration | null;
  actualWork: Duration | null;
  constraintType: ConstraintType | null;
  // Scheduling analysis
  freeSlack: Duration | null;
  totalSlack: Duration | null;
  earlyStart: Date | null;
  earlyFinish: Date | null;
  lateStart: Date | null;
  lateFinish: Date | null;
  levelingDelay: Duration | null;
  deadline: Date | null;
  splits: Date[] | null;
  predecessors: Relation[];
}
