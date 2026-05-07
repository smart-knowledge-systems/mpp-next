// Working-day arithmetic for `@mpp-next/level-core`.
// Hot-loop helpers — Date in / number out at the boundaries; no Dates
// flowing through the leveling pipeline. Tracks spec §2.4 (R4) and S5
// (Uint8Array bits + Int32Array prefix sum).

import type { Calendar } from "../model/Calendar.ts";

import type { DayIndex, ResolvedProject, WorkingCalendar } from "./types.ts";

const MS_PER_DAY = 86_400_000;

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// MSPDI typically stores finish as end-of-workday (e.g., Fri 17:00).
// Round those forward to the next midnight so finishDay (exclusive) lines
// up with the day after the last working day. A finish already at midnight
// is treated as already-exclusive and left alone — including milestones
// where start === finish === midnight.
//
// N3: documented semantic loss on import-export — the original 17:00
// time-of-day does not survive a round trip.
export function endOfLocalDayExclusive(d: Date): Date {
  if (
    d.getHours() === 0 &&
    d.getMinutes() === 0 &&
    d.getSeconds() === 0 &&
    d.getMilliseconds() === 0
  ) {
    return d;
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

export function addCalendarDays(origin: Date, n: number): Date {
  const o = startOfLocalDay(origin);
  return new Date(o.getFullYear(), o.getMonth(), o.getDate() + n);
}

// MS Project dayType: 1=Sun, 2=Mon, …, 7=Sat. JS getDay(): 0=Sun…6=Sat.
function dayTypeOf(d: Date): number {
  return d.getDay() + 1;
}

function exceptionAt(calendar: Calendar, d: Date): { working: boolean } | null {
  const t = startOfLocalDay(d).getTime();
  let match: { working: boolean } | null = null;
  for (const ex of calendar.exceptions) {
    if (!ex.fromDate || !ex.toDate) continue;
    const from = startOfLocalDay(ex.fromDate).getTime();
    const to = startOfLocalDay(ex.toDate).getTime();
    if (t >= from && t <= to) {
      // `working: null` is MS Project's "non-working day" sentinel.
      match = { working: ex.working ?? false };
    }
  }
  return match;
}

function isWorkingDayDate(calendar: Calendar, d: Date): boolean {
  const ex = exceptionAt(calendar, d);
  if (ex) return ex.working;
  const w = calendar.weekDays.find((wd) => wd.dayType === dayTypeOf(d));
  return w?.working ?? false;
}

/** Build a WorkingCalendar with Uint8Array bits and an Int32Array prefix sum.
 *  `cal === null` builds a synthetic calendar treating every day as working —
 *  useful as a fallback when a project has no calendars. */
export function buildWorkingCalendar(
  cal: Calendar | null,
  calendarUniqueId: number | null,
  epoch: Date,
  horizonDays: number,
): WorkingCalendar {
  if (horizonDays < 0) {
    throw new Error(`buildWorkingCalendar: horizonDays must be >= 0, got ${String(horizonDays)}`);
  }
  const epochAtMidnight = startOfLocalDay(epoch);
  const bits = new Uint8Array(horizonDays);
  for (let i = 0; i < horizonDays; i++) {
    const d = addCalendarDays(epochAtMidnight, i);
    bits[i] = (cal === null ? true : isWorkingDayDate(cal, d)) ? 1 : 0;
  }
  // cumWorking[i] = bits[0] + ... + bits[i-1]; cumWorking[horizonDays] is total.
  const cumWorking = new Int32Array(horizonDays + 1);
  for (let i = 0; i < horizonDays; i++) {
    cumWorking[i + 1] = cumWorking[i]! + bits[i]!;
  }
  return {
    calendarUniqueId,
    epoch: epochAtMidnight,
    horizonDays,
    bits,
    cumWorking,
  };
}

export function isWorkingDay(cal: WorkingCalendar, day: DayIndex): boolean {
  return day >= 0 && day < cal.horizonDays && cal.bits[day] === 1;
}

/** O(1) count of working days in `[fromDay, toDay)` clamped to the horizon. */
export function countWorkingDays(cal: WorkingCalendar, fromDay: DayIndex, toDay: DayIndex): number {
  const lo = Math.max(0, fromDay);
  const hi = Math.min(cal.horizonDays, toDay);
  if (hi <= lo) return 0;
  return cal.cumWorking[hi]! - cal.cumWorking[lo]!;
}

/** Forward search from `startDay` for the calendar-day position immediately
 *  after `workingDays` working days have elapsed. Throws if the horizon is
 *  too short. */
export function advanceWorkingDays(
  cal: WorkingCalendar,
  startDay: DayIndex,
  workingDays: number,
): DayIndex {
  if (workingDays <= 0) return startDay;
  let remaining = workingDays;
  let day = startDay;
  while (remaining > 0) {
    if (day >= cal.horizonDays) {
      throw new Error(
        `calendar horizon too short: needed ${String(workingDays)} working days from day ${String(startDay)}, ran out at ${String(day)}`,
      );
    }
    if (cal.bits[day] === 1) remaining--;
    day++;
  }
  return day;
}

/** First working day at or after `day` within the horizon. Returns
 *  `cal.horizonDays` if none. */
export function nextWorkingDay(cal: WorkingCalendar, day: DayIndex): DayIndex {
  let d = Math.max(0, day);
  if (d >= cal.horizonDays) return cal.horizonDays;
  while (d < cal.horizonDays && cal.bits[d] !== 1) d++;
  return d;
}

export function dayToDate(cal: WorkingCalendar, day: DayIndex): Date {
  return addCalendarDays(cal.epoch, day);
}

/** Pick the WorkingCalendar for a given calendar override id, falling back
 *  to the project default and then to any available calendar. Throws if the
 *  ResolvedProject has no calendars at all — a precondition violation. */
export function resolveWorkingCalendar(
  resolved: ResolvedProject,
  calendarUniqueId: number | null,
): WorkingCalendar {
  const id = calendarUniqueId ?? resolved.defaultCalendarUniqueId;
  if (id !== null) {
    const cal = resolved.calendars.get(id);
    if (cal) return cal;
  }
  const fallback = resolved.calendars.values().next().value;
  if (!fallback) {
    throw new Error("resolveWorkingCalendar: ResolvedProject has no calendars");
  }
  return fallback;
}

/** Returns a non-negative day index relative to `cal.epoch`. Caller must
 *  bound-check against `cal.horizonDays` if needed. */
export function dateToDay(cal: WorkingCalendar, date: Date): DayIndex {
  const dStart = startOfLocalDay(date).getTime();
  const eStart = cal.epoch.getTime();
  return Math.round((dStart - eStart) / MS_PER_DAY);
}
