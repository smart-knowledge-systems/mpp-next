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

export interface ProjectProperties {
  title: string | null;
  author: string | null;
  startDate: Date | null;
  finishDate: Date | null;
  statusDate: Date | null;
  defaultCalendarUniqueId: number | null;
  minutesPerDay: number;
  minutesPerWeek: number;
  daysPerMonth: number;
  saveVersion: number | null;
}

export interface WorkingTimeRange {
  from: string;
  to: string;
}

export interface CalendarWeekDay {
  dayType: number;
  working: boolean;
  workingTimes: WorkingTimeRange[];
}

export interface CalendarException {
  name: string | null;
  fromDate: Date | null;
  toDate: Date | null;
  working: boolean | null;
}
