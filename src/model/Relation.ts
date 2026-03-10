import type { Duration } from "./Duration.ts";
import type { RelationType } from "./types.ts";

export interface Relation {
  predecessorUniqueId: number | null;
  successorUniqueId: number | null;
  type: RelationType;
  lag: Duration | null;
}
