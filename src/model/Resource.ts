import type { Duration } from "./Duration.ts";
import type { ResourceType } from "./types.ts";

export interface Resource {
  id: number | null;
  uniqueId: number | null;
  name: string | null;
  type: ResourceType;
  email: string | null;
  group: string | null;
  maxUnits: number | null;
  cost: number | null;
  work: Duration | null;
}
