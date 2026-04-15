import { z } from "zod";

import { NullableDurationSchema } from "./duration.ts";
import { ResourceTypeSchema } from "./types.ts";

export const ResourceSchema = z.object({
  id: z.nullable(z.number()),
  uniqueId: z.nullable(z.number()),
  name: z.nullable(z.string()),
  type: ResourceTypeSchema,
  email: z.nullable(z.string()),
  group: z.nullable(z.string()),
  maxUnits: z.nullable(z.number()),
  cost: z.nullable(z.number()),
  work: NullableDurationSchema,
  resourcePool: z.nullable(z.string()),
});

export type Resource = z.infer<typeof ResourceSchema>;
