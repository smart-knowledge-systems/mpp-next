import type { Duration } from "./Duration.ts";

export interface Assignment {
  taskUniqueId: number | null;
  resourceUniqueId: number | null;
  work: Duration | null;
  units: number | null;
  start: Date | null;
  finish: Date | null;
  actualWork: Duration | null;
  remainingWork: Duration | null;
}
