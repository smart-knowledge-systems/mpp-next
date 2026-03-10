import type { CalendarException, CalendarWeekDay } from "./types.ts";

export interface Calendar {
  uniqueId: number | null;
  name: string | null;
  weekDays: CalendarWeekDay[];
  exceptions: CalendarException[];
}
