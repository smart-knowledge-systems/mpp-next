// ConcurrentUnitsLimit — Constraint block.
//
// A WIP cap on whole work units (the generalized "bay"). Where
// `MaxConcurrentResource` caps crew/throughput (resource-hours), this caps how
// many *units* have active work on any single day — pressuring the search to
// finish open units before opening more.
//
//   • whole-bay limit   — omit `discipline`: "≤ N bays open at once"
//   • discipline limit   — set `discipline` to a resourceUniqueId: "≤ N bays
//     in commissioning at once" (only days with active commissioning count)
//
// This is the *hard* form. The soft companion is `OpenUnitPenalty`, which
// prices WIP across a unit's whole open span (idle gaps included) rather than
// forbidding it. Semantics here are active-day occupancy, matching the
// MiniZinc per-day check below and the greedy serial-SGS implementation.
//
// MiniZinc compile contract: harness supplies `active[t,d]`, `DAYS`, and
// `unit_tasks[u]` (the index set of tasks in unit u, already filtered to the
// discipline when one is set). `unit_open[u,d]` is true iff any task of unit u
// is active on day d.

import { z } from "zod";

import type { ConcurrentUnitsLimitConstraint } from "../level-core/types.ts";

import type { ConstraintBlock, MiniZincFragment } from "./types.ts";

export const ConcurrentUnitsLimitInputSchema = z.object({
  unitIds: z.array(z.number().int()),
  discipline: z.number().int().optional(),
  max: z.number().int().positive(),
});

export type ConcurrentUnitsLimitInput = z.infer<typeof ConcurrentUnitsLimitInputSchema>;

const ConcurrentUnitsLimitOutputSchema: z.ZodType<ConcurrentUnitsLimitConstraint> = z.object({
  kind: z.literal("ConcurrentUnitsLimit"),
  unitIds: z.array(z.number().int()),
  discipline: z.number().int().optional(),
  max: z.number().int().positive(),
});

export const ConcurrentUnitsLimitBlock: ConstraintBlock<ConcurrentUnitsLimitInput> = {
  id: "ConcurrentUnitsLimit",
  schema: {
    input: ConcurrentUnitsLimitInputSchema,
    output: ConcurrentUnitsLimitOutputSchema,
  },
  apply: ({ unitIds, discipline, max }): ConcurrentUnitsLimitConstraint => ({
    kind: "ConcurrentUnitsLimit",
    unitIds,
    discipline,
    max,
  }),
  toMiniZinc: ({ unitIds, max }): MiniZincFragment => {
    const unitIdList = unitIds.map(String).join(",");
    return {
      // `unit_open[u,d]` is supplied/derived by the harness as
      // `exists(t in unit_tasks[u])(active[t,d])`, with unit_tasks already
      // discipline-filtered. Cap the count of open units per day.
      text:
        `constraint forall(d in DAYS) ` +
        `( sum(u in {${unitIdList}}) (bool2int(unit_open[u,d])) <= ${String(max)} );`,
    };
  },
  doc: {
    nl: "At most N work units may have active work on any single day (optionally scoped to one discipline) — a WIP cap that prioritizes finishing open units before starting more.",
    pseudocode: "forall day d: count(u in units where any task of u active on d) <= max",
  },
};
