// Weekly-binned demand profiles derived from a Schedule.
//
// Several scoring blocks (`UnimodalDeviation`, `IdlePercent`, `Smoothness`,
// `HiringLagPenalty`, `LayoffHysteresis`) need the same weekly-peak view of
// per-resource demand. Lift it to level-core so every consumer agrees on
// binning rules (Sunday-snapped, working-day-only, max-per-week).
//
// Sunday-snap origin: v3 (`snapToSunday`) binned weeks from the Sunday
// on-or-before so adjacent runs share boundaries even if their range starts
// differ by a few days. Preserved here as the default.

import { dayToDate, resolveWorkingCalendar } from "./calendarDays.ts";
import type { DayIndex, ResolvedProject, Schedule } from "./types.ts";

export interface WeeklyBucket {
  readonly weekStart: DayIndex;
  readonly value: number;
}

/** Per-resource per-working-day load. O(|assignments| × avg-span). */
export type ResourceLoad = Map<number, Int16Array>;

export function buildResourceLoad(schedule: Schedule): ResourceLoad {
  const cal = resolveWorkingCalendar(schedule.resolved, null);
  const out: ResourceLoad = new Map();

  for (const a of schedule.resolved.assignments) {
    if (!out.has(a.resourceUniqueId)) {
      out.set(a.resourceUniqueId, new Int16Array(cal.horizonDays));
    }
  }

  const taskById = new Map(schedule.tasks.map((t) => [t.uniqueId, t]));
  for (const a of schedule.resolved.assignments) {
    const t = taskById.get(a.taskUniqueId);
    if (!t) continue;
    const arr = out.get(a.resourceUniqueId)!;
    for (let d = t.startDay; d < t.finishDay; d++) {
      if (cal.bits[d] === 1) arr[d]! += a.units;
    }
  }
  return out;
}

export function peakLoad(load: ResourceLoad, resourceId: number): number {
  const arr = load.get(resourceId);
  if (!arr) return 0;
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i]! > m) m = arr[i]!;
  return m;
}

export function combinedPeakLoad(load: ResourceLoad, resourceIds: ReadonlyArray<number>): number {
  const arrs = resourceIds.map((id) => load.get(id)).filter((a): a is Int16Array => !!a);
  if (arrs.length === 0) return 0;
  let m = 0;
  const n = arrs[0]!.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const a of arrs) s += a[i]!;
    if (s > m) m = s;
  }
  return m;
}

/** Snap `day` back to the Sunday on-or-before in the resolved calendar's epoch frame. */
export function snapToSunday(resolved: ResolvedProject, day: DayIndex): DayIndex {
  const cal = resolveWorkingCalendar(resolved, null);
  const d = dayToDate(cal, day);
  return day - d.getDay();
}

/** Per-resource weekly peak — max working-day units in each 7-day window. */
export function weeklyProfile(
  resolved: ResolvedProject,
  arr: Int16Array | undefined,
  rangeStart: DayIndex,
  rangeEnd: DayIndex,
): WeeklyBucket[] {
  if (!arr) return [];
  const cal = resolveWorkingCalendar(resolved, null);
  const result: WeeklyBucket[] = [];
  let ws = snapToSunday(resolved, rangeStart);
  while (ws <= rangeEnd) {
    let max = 0;
    const dStart = Math.max(0, ws);
    const dEnd = Math.min(ws + 6, rangeEnd, cal.horizonDays - 1);
    for (let d = dStart; d <= dEnd; d++) {
      if (cal.bits[d] === 1 && arr[d]! > max) max = arr[d]!;
    }
    result.push({ weekStart: ws, value: max });
    ws += 7;
  }
  return result;
}

/** Combined weekly peak across multiple resources — for "install pool" views. */
export function weeklyProfileCombined(
  resolved: ResolvedProject,
  arrs: ReadonlyArray<Int16Array>,
  rangeStart: DayIndex,
  rangeEnd: DayIndex,
): WeeklyBucket[] {
  const cal = resolveWorkingCalendar(resolved, null);
  const result: WeeklyBucket[] = [];
  let ws = snapToSunday(resolved, rangeStart);
  while (ws <= rangeEnd) {
    let max = 0;
    const dStart = Math.max(0, ws);
    const dEnd = Math.min(ws + 6, rangeEnd, cal.horizonDays - 1);
    for (let d = dStart; d <= dEnd; d++) {
      if (cal.bits[d] !== 1) continue;
      let s = 0;
      for (const a of arrs) s += a[d]!;
      if (s > max) max = s;
    }
    result.push({ weekStart: ws, value: max });
    ws += 7;
  }
  return result;
}

/** Derive a [start, end] day-index range from a Schedule's actual placements. */
export function scheduleSpan(schedule: Schedule): { startDay: DayIndex; endDay: DayIndex } {
  if (schedule.tasks.length === 0) return { startDay: 0, endDay: 0 };
  let s = Infinity;
  let e = 0;
  for (const t of schedule.tasks) {
    if (t.startDay < s) s = t.startDay;
    if (t.finishDay > e) e = t.finishDay;
  }
  return { startDay: s === Infinity ? 0 : s, endDay: e };
}
