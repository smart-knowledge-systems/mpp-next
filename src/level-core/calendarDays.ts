// Working-day arithmetic for `@mpp-next/level-core`.
// Hot-loop helpers — Date in / number out at the boundaries; no Dates
// flowing through the leveling pipeline. Tracks spec §2.4 (R4).

import type { Calendar } from "../schema/calendar.ts";
import type { WorkingDayBitmap } from "./types.ts";

const MS_PER_DAY = 86_400_000;

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// MSPDI typically stores finish as end-of-workday (e.g., Fri 17:00).
// Round those forward to the next midnight so finishDay (exclusive) lines
// up with the day after the last working day. A finish already at midnight
// is treated as already-exclusive and left alone — including milestones
// where start === finish === midnight.
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

export function calendarDayOffset(d: Date, origin: Date): number {
  const dStart = startOfLocalDay(d).getTime();
  const oStart = startOfLocalDay(origin).getTime();
  return Math.round((dStart - oStart) / MS_PER_DAY);
}

export function addCalendarDays(origin: Date, n: number): Date {
  const o = startOfLocalDay(origin);
  return new Date(o.getFullYear(), o.getMonth(), o.getDate() + n);
}

export function dayIndexToDate(dayIndex: number, origin: Date): Date {
  return addCalendarDays(origin, dayIndex);
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

export function isWorkingDay(calendar: Calendar, d: Date): boolean {
  const ex = exceptionAt(calendar, d);
  if (ex) return ex.working;
  const w = calendar.weekDays.find((wd) => wd.dayType === dayTypeOf(d));
  return w?.working ?? false;
}

export function buildBitmap(calendar: Calendar, origin: Date, numDays: number): WorkingDayBitmap {
  const bitmap: boolean[] = new Array(numDays);
  for (let i = 0; i < numDays; i++) {
    bitmap[i] = isWorkingDay(calendar, addCalendarDays(origin, i));
  }
  return bitmap;
}

export function countWorkingDays(
  bitmap: WorkingDayBitmap,
  startDay: number,
  finishDay: number,
): number {
  let count = 0;
  const lo = Math.max(0, startDay);
  const hi = Math.min(bitmap.length, finishDay);
  for (let i = lo; i < hi; i++) {
    if (bitmap[i]) count++;
  }
  return count;
}

// Forward search from startDay for the calendar-day position immediately
// after `workingDays` working days have elapsed. The search engine in step 3
// uses this to place tasks once it knows their working-day duration.
export function advanceWorkingDays(
  bitmap: WorkingDayBitmap,
  startDay: number,
  workingDays: number,
): number {
  if (workingDays <= 0) return startDay;
  let remaining = workingDays;
  let day = startDay;
  while (remaining > 0) {
    if (day >= bitmap.length) {
      throw new Error(
        `calendar bitmap too short: needed ${String(workingDays)} working days from day ${String(startDay)}, ran out at ${String(day)}`,
      );
    }
    if (bitmap[day]) remaining--;
    day++;
  }
  return day;
}
