import { z } from "zod";

import { NullableDateStringSchema } from "./date.ts";
import { NullableDurationSchema } from "./duration.ts";
import { RelationSchema } from "./relation.ts";
import { ConstraintTypeSchema } from "./types.ts";

export const TaskSchema = z.object({
  id: z.nullable(z.number()),
  uniqueId: z.nullable(z.number()),
  name: z.nullable(z.string()),
  wbs: z.nullable(z.string()),
  outlineLevel: z.nullable(z.number()),
  start: NullableDateStringSchema,
  finish: NullableDateStringSchema,
  duration: NullableDurationSchema,
  percentComplete: z.nullable(z.number()),
  summary: z.nullable(z.boolean()),
  milestone: z.nullable(z.boolean()),
  critical: z.nullable(z.boolean()),
  notes: z.nullable(z.string()),
  priority: z.nullable(z.number()),
  cost: z.nullable(z.number()),
  work: NullableDurationSchema,
  actualStart: NullableDateStringSchema,
  actualFinish: NullableDateStringSchema,
  baselineStart: NullableDateStringSchema,
  baselineFinish: NullableDateStringSchema,
  baselineDuration: NullableDurationSchema,
  actualWork: NullableDurationSchema,
  constraintType: z.nullable(ConstraintTypeSchema),
  freeSlack: NullableDurationSchema,
  totalSlack: NullableDurationSchema,
  earlyStart: NullableDateStringSchema,
  earlyFinish: NullableDateStringSchema,
  lateStart: NullableDateStringSchema,
  lateFinish: NullableDateStringSchema,
  levelingDelay: NullableDurationSchema,
  deadline: NullableDateStringSchema,
  splits: z.nullable(z.array(z.string().transform((val) => new Date(val)))),
  predecessors: z.array(RelationSchema),
});
