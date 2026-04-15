export enum TimeUnit {
  Minutes = "minutes",
  Hours = "hours",
  Days = "days",
  Weeks = "weeks",
  Months = "months",
  Percent = "percent",
}

export enum RelationType {
  FinishToStart = "FS",
  StartToStart = "SS",
  FinishToFinish = "FF",
  StartToFinish = "SF",
}

export enum ResourceType {
  Material = "Material",
  Work = "Work",
  Cost = "Cost",
}

export enum ConstraintType {
  AsSoonAsPossible = "ASAP",
  AsLateAsPossible = "ALAP",
  MustStartOn = "MSO",
  MustFinishOn = "MFO",
  StartNoEarlierThan = "SNET",
  StartNoLaterThan = "SNLT",
  FinishNoEarlierThan = "FNET",
  FinishNoLaterThan = "FNLT",
}

export enum Priority {
  Lowest = 100,
  Low = 250,
  Medium = 500,
  High = 750,
  Highest = 1000,
}

export type { ProjectProperties } from "../schema/project.ts";
export type { WorkingTimeRange, CalendarWeekDay, CalendarException } from "../schema/calendar.ts";
