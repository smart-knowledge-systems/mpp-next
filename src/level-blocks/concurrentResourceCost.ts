// ConcurrentResourceCost — Scoring block (soft companion to
// `MaxConcurrentResource` per spec §4.3).
//
// Where `MaxConcurrentResource` is a *hard* cap on simultaneous activity,
// this scorer prices each marginal concurrent worker on an *exponential*
// curve: pulling the 5th skilled crew off other high-value work costs much
// more than pulling the 2nd. The model is per-working-day:
//
//   day_cost(load) = basePrice × (growthBase^load − 1)
//
// summed across working days the resource is active. growthBase = 1 is
// degenerate (always 0); growthBase > 1 makes each additional concurrent
// unit super-linear. The original `MaxConcurrentResource` cap is the
// asymptote — beyond it the search rejects outright, below it this scorer
// shapes the search toward fewer-concurrent-worker schedules.
//
// `threshold` (optional) makes the first N concurrent workers free:
//
//   day_cost(load) = load ≤ threshold ? 0 : basePrice × (growthBase^(load − threshold) − 1)
//
// Useful when the first crew is core staff at flat cost and only overflow
// pulls from elsewhere.
//
// MiniZinc compile contract: harness supplies `units[t,r]`, `active[t,d]`,
// `DAYS`. Note that exponentials don't lower cleanly to CP-SAT; for the
// remote backend a piecewise-linear approximation is typically substituted
// at the compiler layer.

import { z } from "zod";

import { resolveWorkingCalendar } from "../level-core/calendarDays.ts";
import type { Schedule, Scorer } from "../level-core/types.ts";

import type { MiniZincFragment, ScoringBlock } from "./types.ts";

export const ConcurrentResourceCostInputSchema = z.object({
  resourceUniqueId: z.number().int(),
  basePrice: z.number().positive(),
  growthBase: z.number().gt(1),
  threshold: z.number().int().nonnegative().default(0),
});

export type ConcurrentResourceCostInput = z.infer<typeof ConcurrentResourceCostInputSchema>;

const ScorerOutputSchema: z.ZodType<Scorer> = z.custom<Scorer>(
  (val): val is Scorer =>
    typeof val === "object" &&
    val !== null &&
    typeof (val as Scorer).name === "string" &&
    ((val as Scorer).direction === "min" || (val as Scorer).direction === "max") &&
    typeof (val as Scorer).score === "function",
);

export function dayCost(
  load: number,
  basePrice: number,
  growthBase: number,
  threshold: number,
): number {
  if (load <= threshold) return 0;
  return basePrice * (Math.pow(growthBase, load - threshold) - 1);
}

export const ConcurrentResourceCostBlock: ScoringBlock<ConcurrentResourceCostInput> = {
  id: "ConcurrentResourceCost",
  schema: { input: ConcurrentResourceCostInputSchema, output: ScorerOutputSchema },
  apply: ({ resourceUniqueId, basePrice, growthBase, threshold }): Scorer => ({
    name: `ConcurrentResourceCost[r=${String(resourceUniqueId)}]`,
    direction: "min",
    score(schedule: Schedule): number {
      const cal = resolveWorkingCalendar(schedule.resolved, null);
      const assignmentsForResource = schedule.resolved.assignments.filter(
        (a) => a.resourceUniqueId === resourceUniqueId,
      );
      if (assignmentsForResource.length === 0) return 0;

      const taskUnits = new Map<number, number>();
      for (const a of assignmentsForResource) {
        taskUnits.set(a.taskUniqueId, (taskUnits.get(a.taskUniqueId) ?? 0) + a.units);
      }

      const daily = new Int32Array(cal.horizonDays);
      for (const t of schedule.tasks) {
        const units = taskUnits.get(t.uniqueId);
        if (units === undefined || units === 0) continue;
        for (let d = t.startDay; d < t.finishDay; d++) {
          if (cal.bits[d] === 1) daily[d]! += units;
        }
      }

      let total = 0;
      for (let d = 0; d < daily.length; d++) {
        if (daily[d]! > 0) total += dayCost(daily[d]!, basePrice, growthBase, threshold);
      }
      return total;
    },
  }),
  toMiniZinc: ({ resourceUniqueId, basePrice, growthBase, threshold }): MiniZincFragment => ({
    // Exponential cost doesn't lower cleanly into CP-SAT integers; the
    // canonical compile path is a piecewise-linear approximation applied at
    // the compiler layer, parameterized off this fragment's growthBase.
    text:
      `var float: concurrent_resource_cost_${String(resourceUniqueId)} = ` +
      `sum(d in DAYS) ` +
      `( let { var int: load = ` +
      `sum(t in tasks_demanding[${String(resourceUniqueId)}]) ` +
      `(bool2int(active[t,d]) * units[t,${String(resourceUniqueId)}]) } in ` +
      `if load <= ${String(threshold)} then 0.0 else ` +
      `${String(basePrice)} * (pow(${String(growthBase)}, load - ${String(threshold)}) - 1.0) endif );`,
  }),
  doc: {
    nl: "Exponential per-day penalty on concurrent demand: each marginal worker beyond threshold costs growthBase× more than the previous one.",
    pseudocode:
      "sum_d (load[d] > threshold ? basePrice * (growthBase^(load[d] - threshold) - 1) : 0)",
  },
};
