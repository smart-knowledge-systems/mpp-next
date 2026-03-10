import { z } from "zod";

import { NullableDateStringSchema } from "./date.ts";
import { TaskSchema } from "./task.ts";
import { ResourceSchema } from "./resource.ts";
import { AssignmentSchema } from "./assignment.ts";
import { CalendarSchema } from "./calendar.ts";

export const ProjectPropertiesSchema = z.object({
  title: z.nullable(z.string()),
  author: z.nullable(z.string()),
  startDate: NullableDateStringSchema,
  finishDate: NullableDateStringSchema,
  statusDate: NullableDateStringSchema,
  defaultCalendarUniqueId: z.nullable(z.number()),
  minutesPerDay: z.number().default(480),
  minutesPerWeek: z.number().default(2400),
  daysPerMonth: z.number().default(20),
  saveVersion: z.nullable(z.number()),
});

export const ProjectFileSchema = z.object({
  properties: ProjectPropertiesSchema,
  tasks: z.array(TaskSchema),
  resources: z.array(ResourceSchema),
  assignments: z.array(AssignmentSchema),
  calendars: z.array(CalendarSchema),
});
