import { z } from "zod";

import { NullableDurationSchema } from "./duration.ts";
import { RelationTypeSchema } from "./types.ts";

export const RelationSchema = z.object({
  predecessorUniqueId: z.nullable(z.number()),
  successorUniqueId: z.nullable(z.number()),
  type: RelationTypeSchema,
  lag: NullableDurationSchema,
});

export type Relation = z.infer<typeof RelationSchema>;
