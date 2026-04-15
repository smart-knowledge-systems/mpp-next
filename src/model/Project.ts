export type { ProjectFile } from "../schema/project.ts";

export function createEmptyProject(): import("../schema/project.ts").ProjectFile {
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
