// OpenUnitPenalty — Scoring block (soft companion to ConcurrentUnitsLimit).
//
// Prices work-in-progress on whole units. Where the hard `ConcurrentUnitsLimit`
// forbids more than N units having *active* work on a day, this scorer prices
// the number of *open* units each day — open meaning between a unit's first
// start and last finish, idle gaps included. A half-finished bay sitting idle
// still ties up handover/supervision attention, so it still counts as WIP.
// That open-span view is the truer "prioritize completion" pressure and the
// reason this is the soft general-bay limit (a hard cap can stall when every
// open unit is momentarily blocked).
//
//   day_penalty(d) = weight × max(0, openUnits(d) − softMax)
//
// summed over working days. `discipline` (a resourceUniqueId) scopes the open
// span to that discipline's tasks — "how many bays are mid-commissioning."
// Omit it for the whole-bay limit. `softMax` is the free allowance; with
// softMax = 0 every open-unit-day is priced.
//
// MiniZinc compile contract: harness supplies `unit_open_span[u,d]` (true
// between unit u's first start and last finish, discipline-filtered) and
// `DAYS`. Distinct from the hard constraint's active-day `unit_open[u,d]`.

import { z } from "zod";

import { resolveWorkingCalendar } from "../level-core/calendarDays.ts";
import type { Schedule, Scorer } from "../level-core/types.ts";

import type { MiniZincFragment, ScoringBlock } from "./types.ts";

export const OpenUnitPenaltyInputSchema = z.object({
  unitIds: z.array(z.number().int()),
  discipline: z.number().int().optional(),
  softMax: z.number().int().nonnegative().default(0),
  weight: z.number().positive().default(1),
});

export type OpenUnitPenaltyInput = z.infer<typeof OpenUnitPenaltyInputSchema>;

const ScorerOutputSchema: z.ZodType<Scorer> = z.custom<Scorer>(
  (val): val is Scorer =>
    typeof val === "object" &&
    val !== null &&
    typeof (val as Scorer).name === "string" &&
    ((val as Scorer).direction === "min" || (val as Scorer).direction === "max") &&
    typeof (val as Scorer).score === "function",
);

export const OpenUnitPenaltyBlock: ScoringBlock<OpenUnitPenaltyInput> = {
  id: "OpenUnitPenalty",
  schema: { input: OpenUnitPenaltyInputSchema, output: ScorerOutputSchema },
  apply: (input): Scorer => {
    const { unitIds, discipline, softMax, weight } = OpenUnitPenaltyInputSchema.parse(input);
    // MiniZinc treats the id list as a set, so iterate distinct ids here too —
    // a duplicate reference must not double-count a unit's open span.
    const distinctUnitIds = [...new Set(unitIds)];
    return {
      name: `OpenUnitPenalty[${discipline === undefined ? "all" : `r=${String(discipline)}`}]`,
      direction: "min",
      score(schedule: Schedule): number {
        const cal = resolveWorkingCalendar(schedule.resolved, null);
        const startById = new Map(schedule.tasks.map((t) => [t.uniqueId, t]));

        // Tasks that count toward a unit's open span — discipline-filtered.
        const counts = (taskId: number): boolean => {
          if (discipline === undefined) return true;
          return schedule.resolved.assignments.some(
            (a) => a.taskUniqueId === taskId && a.resourceUniqueId === discipline,
          );
        };

        // Per working day, how many units are open (first start ≤ d < last finish).
        const openCount = new Int32Array(cal.horizonDays);
        for (const unitId of distinctUnitIds) {
          const unit = schedule.resolved.workUnits.get(unitId);
          if (!unit) continue;
          let spanStart = Infinity;
          let spanFinish = -Infinity;
          for (const taskId of unit.taskUniqueIds) {
            if (!counts(taskId)) continue;
            const t = startById.get(taskId);
            if (!t) continue;
            if (t.startDay < spanStart) spanStart = t.startDay;
            if (t.finishDay > spanFinish) spanFinish = t.finishDay;
          }
          if (spanStart === Infinity || spanFinish <= spanStart) continue;
          for (let d = spanStart; d < spanFinish && d < cal.horizonDays; d++) {
            if (cal.bits[d] === 1) openCount[d]! += 1;
          }
        }

        let total = 0;
        for (let d = 0; d < openCount.length; d++) {
          const over = openCount[d]! - softMax;
          if (over > 0) total += weight * over;
        }
        return total;
      },
    };
  },
  toMiniZinc: (input): MiniZincFragment => {
    const { unitIds, softMax, weight } = OpenUnitPenaltyInputSchema.parse(input);
    const unitIdList = unitIds.map(String).join(",");
    return {
      text:
        `var float: open_unit_penalty = sum(d in DAYS) ` +
        `( ${String(weight)} * max(0, ` +
        `sum(u in {${unitIdList}}) (bool2int(unit_open_span[u,d])) - ${String(softMax)}) );`,
    };
  },
  doc: {
    nl: "Soft WIP penalty: prices each open-unit-day beyond a free allowance (softMax), where a unit is open across its whole span including idle gaps. Pressures the schedule to finish units before opening more.",
    pseudocode: "sum_d weight * max(0, count(u open on d) - softMax)",
  },
};
