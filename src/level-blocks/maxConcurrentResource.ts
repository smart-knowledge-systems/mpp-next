// MaxConcurrentResource — first concrete v4 Block (§4.3).
//
// Caps the number of *tasks* that may simultaneously demand a named
// resource on any working day. Counts tasks (boolean activity), not
// fractional unit demand — the unit-summing variant is `PeakCap`. The
// greedy serial-SGS and the MiniZinc fragment both use task-count
// semantics so the two backends agree on part-time assignments.
//
// MiniZinc target shape (matches the v1 compile contract): `active[t,d]`
// is the boolean activity matrix, `tasks_demanding[r]` the index set of
// tasks demanding resource `r`, and `DAYS` the day-index set — all
// supplied by the compilation harness, not the block.

import { z } from "zod";

import type { MaxConcurrentResourceConstraint } from "../level-core/types.ts";

import type { ConstraintBlock, MiniZincFragment } from "./types.ts";

export const MaxConcurrentResourceInputSchema = z.object({
  resourceUniqueId: z.number().int(),
  max: z.number().int().positive(),
});

export type MaxConcurrentResourceInput = z.infer<typeof MaxConcurrentResourceInputSchema>;

const MaxConcurrentResourceOutputSchema: z.ZodType<MaxConcurrentResourceConstraint> = z.object({
  kind: z.literal("MaxConcurrentResource"),
  resourceUniqueId: z.number().int(),
  max: z.number().int().positive(),
});

export const MaxConcurrentResourceBlock: ConstraintBlock<MaxConcurrentResourceInput> = {
  id: "MaxConcurrentResource",
  schema: {
    input: MaxConcurrentResourceInputSchema,
    output: MaxConcurrentResourceOutputSchema,
  },
  apply: ({ resourceUniqueId, max }): MaxConcurrentResourceConstraint => ({
    kind: "MaxConcurrentResource",
    resourceUniqueId,
    max,
  }),
  toMiniZinc: ({ resourceUniqueId, max }): MiniZincFragment => ({
    text:
      `constraint forall(d in DAYS) ` +
      `( sum(t in tasks_demanding[${String(resourceUniqueId)}]) ` +
      `(bool2int(active[t,d])) <= ${String(max)} );`,
  }),
  doc: {
    nl: "At most N tasks may simultaneously demand the named resource on any working day.",
    pseudocode: "forall day d: count(t demanding r and active(t,d)) <= max",
  },
};
