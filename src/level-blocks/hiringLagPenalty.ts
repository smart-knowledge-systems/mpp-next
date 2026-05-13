// HiringLagPenalty — Scoring block (plan §A1).
//
// Models v3's training-lag economics (level-resources-v3.ts:561-617): each
// time the weekly headcount for a resource increases above the prior week's
// level counts as a hire; each hire incurs `trainingWeeks × costPerCrewWeek`
// because new staff are on payroll but not yet productive. The penalty is
// soft — `MaxConcurrentResource` and `PeakCap` already handle hard caps.
//
// Week binning lives in level-core/weeklyProfile.ts (Sunday-snapped,
// working-day-only). All scoring blocks share that derivation so they agree
// on bin boundaries.
//
// MiniZinc compile contract: the harness must supply `weekly_demand[r,w]`
// (int array indexed by resource and week) and `WEEKS` (int set). This block
// emits the objective-contribution constraint.

import { z } from "zod";

import { buildResourceLoad, scheduleSpan, weeklyProfile } from "../level-core/weeklyProfile.ts";
import type { Schedule, Scorer } from "../level-core/types.ts";

import type { MiniZincFragment, ScoringBlock } from "./types.ts";

export const HiringLagPenaltyInputSchema = z.object({
  resourceUniqueId: z.number().int(),
  trainingWeeks: z.number().positive(),
  costPerCrewWeek: z.number().nonnegative(),
});

export type HiringLagPenaltyInput = z.infer<typeof HiringLagPenaltyInputSchema>;

const ScorerOutputSchema: z.ZodType<Scorer> = z.custom<Scorer>(
  (val): val is Scorer =>
    typeof val === "object" &&
    val !== null &&
    typeof (val as Scorer).name === "string" &&
    ((val as Scorer).direction === "min" || (val as Scorer).direction === "max") &&
    typeof (val as Scorer).score === "function",
);

export function totalHires(profile: ReadonlyArray<number>): number {
  if (profile.length === 0) return 0;
  let hires = profile[0]!;
  for (let i = 1; i < profile.length; i++) {
    const delta = profile[i]! - profile[i - 1]!;
    if (delta > 0) hires += delta;
  }
  return hires;
}

export const HiringLagPenaltyBlock: ScoringBlock<HiringLagPenaltyInput> = {
  id: "HiringLagPenalty",
  schema: {
    input: HiringLagPenaltyInputSchema,
    output: ScorerOutputSchema,
  },
  apply: ({ resourceUniqueId, trainingWeeks, costPerCrewWeek }): Scorer => ({
    name: `HiringLagPenalty[r=${String(resourceUniqueId)}]`,
    direction: "min",
    score(schedule: Schedule): number {
      const { startDay, endDay } = scheduleSpan(schedule);
      if (endDay === 0) return 0;
      const load = buildResourceLoad(schedule);
      const profile = weeklyProfile(
        schedule.resolved,
        load.get(resourceUniqueId),
        startDay,
        endDay,
      );
      return totalHires(profile.map((b) => b.value)) * trainingWeeks * costPerCrewWeek;
    },
  }),
  toMiniZinc: ({ resourceUniqueId, trainingWeeks, costPerCrewWeek }): MiniZincFragment => ({
    text:
      `var int: hiring_lag_penalty_${String(resourceUniqueId)} = ` +
      `sum(w in WEEKS where w > 1) ` +
      `( max(0, weekly_demand[${String(resourceUniqueId)},w] - ` +
      `weekly_demand[${String(resourceUniqueId)},w-1]) ) ` +
      `* ${String(trainingWeeks)} * ${String(costPerCrewWeek)};`,
  }),
  doc: {
    nl: "Penalty for headcount increases on a resource: each week-over-week rise counts as new hires that cost (trainingWeeks × costPerCrewWeek) before becoming productive.",
    pseudocode:
      "hires = profile[0] + sum_{w>0} max(0, profile[w] - profile[w-1]); penalty = hires * trainingWeeks * costPerCrewWeek",
  },
};
