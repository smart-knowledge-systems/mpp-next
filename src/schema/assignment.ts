import { z } from "zod";

import { NullableDateStringSchema } from "./date.ts";
import { NullableDurationSchema } from "./duration.ts";

export const AssignmentSchema = z.object({
  taskUniqueId: z.nullable(z.number()),
  resourceUniqueId: z.nullable(z.number()),
  work: NullableDurationSchema,
  units: z.nullable(z.number()),
  start: NullableDateStringSchema,
  finish: NullableDateStringSchema,
  actualWork: NullableDurationSchema,
  remainingWork: NullableDurationSchema,
});
