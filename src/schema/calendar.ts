import { z } from "zod";

import { NullableDateStringSchema } from "./date.ts";

export const WorkingTimeRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const CalendarWeekDaySchema = z.object({
  dayType: z.number(),
  working: z.boolean(),
  workingTimes: z.array(WorkingTimeRangeSchema),
});

export const CalendarExceptionSchema = z.object({
  name: z.nullable(z.string()),
  fromDate: NullableDateStringSchema,
  toDate: NullableDateStringSchema,
  working: z.nullable(z.boolean()),
});

export const CalendarSchema = z.object({
  uniqueId: z.nullable(z.number()),
  name: z.nullable(z.string()),
  weekDays: z.array(CalendarWeekDaySchema),
  exceptions: z.array(CalendarExceptionSchema),
});
