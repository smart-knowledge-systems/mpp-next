// UnimodalDeviation — Scoring block.
//
// Quantitative companion to `UnimodalProfileConstraint`. The constraint
// is a hard shape rule (one ramp up, one ramp down); the scorer surfaces
// "how far off" a profile is when the constraint isn't enforced — and is
// also what a search transformer would tiebreak on when serialSGS can't
// enforce the constraint directly.
//
// Algorithm: walk the per-resource weekly peak profile, locate the dominant
// peak, and sum the magnitudes of dips before it and bumps after it. Unlike
// a hard ok/violations check, this scorer returns a deviation magnitude so
// it can drive search.
//
// MiniZinc compile contract: harness supplies `weekly_demand[r,w]` and
// `WEEKS` (same as HiringLagPenalty). The emitted objective term is the
// sum of negative weekly-delta magnitudes before the peak plus positive
// weekly-delta magnitudes after the peak — computed in MiniZinc via
// shape-sensitive `if … then … else` expressions.

import { z } from "zod";

import { buildResourceLoad, scheduleSpan, weeklyProfile } from "../level-core/weeklyProfile.ts";
import type { Schedule, Scorer } from "../level-core/types.ts";

import type { MiniZincFragment, ScoringBlock } from "./types.ts";

export const UnimodalDeviationInputSchema = z.object({
  resourceUniqueId: z.number().int(),
  allowSecondPeak: z.boolean().default(false),
  jitterTolerance: z.number().int().nonnegative().default(1),
});

export type UnimodalDeviationInput = z.infer<typeof UnimodalDeviationInputSchema>;

const ScorerOutputSchema: z.ZodType<Scorer> = z.custom<Scorer>(
  (val): val is Scorer =>
    typeof val === "object" &&
    val !== null &&
    typeof (val as Scorer).name === "string" &&
    ((val as Scorer).direction === "min" || (val as Scorer).direction === "max") &&
    typeof (val as Scorer).score === "function",
);

/** Sum of off-pattern dip/bump magnitudes around the dominant peak.
 *  Returns 0 for a strictly unimodal profile within `jitterTolerance`. */
export function unimodalDeviation(
  values: ReadonlyArray<number>,
  allowSecondPeak: boolean,
  jitterTolerance: number,
): number {
  const nonzero = values.filter((v) => v > 0);
  if (nonzero.length <= 2) return 0;

  let peakIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[peakIdx]!) peakIdx = i;
  }

  let deviation = 0;
  // Dips before the dominant peak: contiguous-from-rise descents.
  for (let i = 1; i <= peakIdx; i++) {
    const drop = values[i - 1]! - values[i]!;
    if (drop > jitterTolerance) deviation += drop - jitterTolerance;
  }

  // Bumps after the dominant peak: rises after the profile starts descending.
  let descending = false;
  let bumpsObserved = 0;
  for (let i = peakIdx + 1; i < values.length; i++) {
    const delta = values[i]! - values[i - 1]!;
    if (-delta > jitterTolerance) descending = true;
    if (descending && delta > jitterTolerance) {
      bumpsObserved++;
      if (!allowSecondPeak || bumpsObserved > 1) {
        deviation += delta - jitterTolerance;
      }
      descending = false;
    }
  }
  return deviation;
}

export const UnimodalDeviationBlock: ScoringBlock<UnimodalDeviationInput> = {
  id: "UnimodalDeviation",
  schema: { input: UnimodalDeviationInputSchema, output: ScorerOutputSchema },
  apply: (input): Scorer => {
    const { resourceUniqueId, allowSecondPeak, jitterTolerance } =
      UnimodalDeviationInputSchema.parse(input);
    return {
      name: `UnimodalDeviation[r=${String(resourceUniqueId)}]`,
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
        return unimodalDeviation(
          profile.map((b) => b.value),
          allowSecondPeak,
          jitterTolerance,
        );
      },
    };
  },
  toMiniZinc: (input): MiniZincFragment => {
    const { resourceUniqueId, allowSecondPeak, jitterTolerance } =
      UnimodalDeviationInputSchema.parse(input);
    return {
      // Closed-form MiniZinc encoding needs `peak_week[r]` from the harness;
      // we emit the parametrized soft-deviation term against weekly_demand.
      text:
        `var int: unimodal_deviation_${String(resourceUniqueId)} = ` +
        `sum(w in WEEKS where w > 1 /\\ w <= peak_week[${String(resourceUniqueId)}]) ` +
        `( max(0, weekly_demand[${String(resourceUniqueId)},w-1] - ` +
        `weekly_demand[${String(resourceUniqueId)},w] - ${String(jitterTolerance)}) ) + ` +
        `sum(w in WEEKS where w > peak_week[${String(resourceUniqueId)}]) ` +
        `( ${allowSecondPeak ? "0" : "max(0, weekly_demand[" + String(resourceUniqueId) + ",w] - weekly_demand[" + String(resourceUniqueId) + ",w-1] - " + String(jitterTolerance) + ")"} );`,
    };
  },
  doc: {
    nl: "Magnitude of off-pattern dips before the dominant peak and bumps after it. Zero for a strictly unimodal profile within jitter tolerance.",
    pseudocode:
      "sum(drop_i for i ≤ peak if drop_i > tol) + sum(rise_i for i > peak after descent if !allowSecondPeak || nth>1)",
  },
};
