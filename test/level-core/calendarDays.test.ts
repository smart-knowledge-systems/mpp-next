import { test, expect, describe } from "bun:test";

import {
  addCalendarDays,
  advanceWorkingDays,
  buildWorkingCalendar,
  countWorkingDays,
  dateToDay,
  dayToDate,
  endOfLocalDayExclusive,
  isWorkingDay,
  nextWorkingDay,
  startOfLocalDay,
} from "../../src/level-core/calendarDays.ts";
import type { Calendar } from "../../src/model/Calendar.ts";

const monFri: Calendar = {
  uniqueId: 1,
  name: "Mon-Fri",
  weekDays: [
    { dayType: 1, working: false, workingTimes: [] },
    { dayType: 2, working: true, workingTimes: [] },
    { dayType: 3, working: true, workingTimes: [] },
    { dayType: 4, working: true, workingTimes: [] },
    { dayType: 5, working: true, workingTimes: [] },
    { dayType: 6, working: true, workingTimes: [] },
    { dayType: 7, working: false, workingTimes: [] },
  ],
  exceptions: [],
};

// Wed, Jan 1, 2025
const epoch = new Date(2025, 0, 1);

describe("buildWorkingCalendar", () => {
  test("Mon-Fri 14-day window has 10 working days", () => {
    const cal = buildWorkingCalendar(monFri, 1, epoch, 14);
    expect(cal.cumWorking[14]).toBe(10);
  });

  test("synthetic calendar (cal=null) treats every day as working", () => {
    const cal = buildWorkingCalendar(null, null, epoch, 7);
    expect(cal.cumWorking[7]).toBe(7);
    expect([...cal.bits]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  test("rejects negative horizon", () => {
    expect(() => buildWorkingCalendar(monFri, 1, epoch, -1)).toThrow();
  });

  test("zero-horizon calendar is valid", () => {
    const cal = buildWorkingCalendar(monFri, 1, epoch, 0);
    expect(cal.bits.length).toBe(0);
    expect(cal.cumWorking.length).toBe(1);
    expect(cal.cumWorking[0]).toBe(0);
  });
});

describe("countWorkingDays — O(1) prefix-sum query", () => {
  const cal = buildWorkingCalendar(monFri, 1, epoch, 21);

  test("first work-week is 5 working days", () => {
    expect(countWorkingDays(cal, 0, 7)).toBe(5);
  });

  test("range across a weekend gap", () => {
    // Wed→Mon is 4 days: Wed, Thu, Fri, Mon (Sat, Sun nonworking).
    expect(countWorkingDays(cal, 0, 6)).toBe(4);
  });

  test("clamps to horizon", () => {
    expect(countWorkingDays(cal, -5, 200)).toBe(15);
  });

  test("empty range is 0", () => {
    expect(countWorkingDays(cal, 5, 5)).toBe(0);
    expect(countWorkingDays(cal, 7, 3)).toBe(0);
  });
});

describe("isWorkingDay / nextWorkingDay", () => {
  const cal = buildWorkingCalendar(monFri, 1, epoch, 14);

  test("isWorkingDay agrees with bits", () => {
    // Wed is working, Sat/Sun (days 3, 4) are not.
    expect(isWorkingDay(cal, 0)).toBe(true);
    expect(isWorkingDay(cal, 3)).toBe(false);
    expect(isWorkingDay(cal, 4)).toBe(false);
    expect(isWorkingDay(cal, 5)).toBe(true);
  });

  test("nextWorkingDay skips weekends", () => {
    expect(nextWorkingDay(cal, 3)).toBe(5);
  });

  test("nextWorkingDay returns horizon if none ahead", () => {
    expect(nextWorkingDay(cal, 999)).toBe(14);
  });
});

describe("advanceWorkingDays", () => {
  const cal = buildWorkingCalendar(monFri, 1, epoch, 30);

  test("advance 5 working days from Wed Jan 1 lands on Wed Jan 8", () => {
    expect(advanceWorkingDays(cal, 0, 5)).toBe(7);
  });

  test("advance 0 working days is identity", () => {
    expect(advanceWorkingDays(cal, 0, 0)).toBe(0);
    expect(advanceWorkingDays(cal, 7, 0)).toBe(7);
  });

  test("throws when horizon too short", () => {
    const small = buildWorkingCalendar(monFri, 1, epoch, 3);
    expect(() => advanceWorkingDays(small, 0, 5)).toThrow();
  });
});

describe("dayToDate / dateToDay round trip", () => {
  const cal = buildWorkingCalendar(monFri, 1, epoch, 60);

  test("dateToDay(dayToDate(d)) === d for every d in horizon", () => {
    for (let d = 0; d < cal.horizonDays; d++) {
      expect(dateToDay(cal, dayToDate(cal, d))).toBe(d);
    }
  });

  test("identity holds across DST boundaries (US spring-forward)", () => {
    const dstEpoch = new Date(2025, 2, 1); // Mar 1
    const dstCal = buildWorkingCalendar(monFri, 1, dstEpoch, 30);
    for (let d = 0; d < dstCal.horizonDays; d++) {
      expect(dateToDay(dstCal, dayToDate(dstCal, d))).toBe(d);
    }
  });
});

describe("endOfLocalDayExclusive — MSPDI 17:00 → next-midnight normalization", () => {
  test("Fri 17:00 rounds to Sat 00:00", () => {
    const fri17 = new Date(2025, 0, 3, 17);
    const result = endOfLocalDayExclusive(fri17);
    expect(result.getDate()).toBe(4);
    expect(result.getHours()).toBe(0);
  });

  test("midnight is left alone (milestones)", () => {
    const midnight = new Date(2025, 0, 3);
    expect(endOfLocalDayExclusive(midnight).getTime()).toBe(midnight.getTime());
  });
});

describe("startOfLocalDay / addCalendarDays", () => {
  test("startOfLocalDay strips time component", () => {
    const t = new Date(2025, 5, 15, 14, 30, 25);
    const s = startOfLocalDay(t);
    expect(s.getHours()).toBe(0);
    expect(s.getDate()).toBe(15);
  });

  test("addCalendarDays handles month rollover", () => {
    const jan31 = new Date(2025, 0, 31);
    const feb1 = addCalendarDays(jan31, 1);
    expect(feb1.getMonth()).toBe(1);
    expect(feb1.getDate()).toBe(1);
  });
});
