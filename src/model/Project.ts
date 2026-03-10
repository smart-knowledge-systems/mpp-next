import type { Assignment } from "./Assignment.ts";
import type { Calendar } from "./Calendar.ts";
import type { Resource } from "./Resource.ts";
import type { Task } from "./Task.ts";
import type { ProjectProperties } from "./types.ts";

export interface ProjectFile {
  properties: ProjectProperties;
  tasks: Task[];
  resources: Resource[];
  assignments: Assignment[];
  calendars: Calendar[];
}

export function createEmptyProject(): ProjectFile {
  return {
    properties: {
      title: null,
      author: null,
      startDate: null,
      finishDate: null,
      statusDate: null,
      defaultCalendarUniqueId: null,
      minutesPerDay: 480,
      minutesPerWeek: 2400,
      daysPerMonth: 20,
      saveVersion: null,
    },
    tasks: [],
    resources: [],
    assignments: [],
    calendars: [],
  };
}
