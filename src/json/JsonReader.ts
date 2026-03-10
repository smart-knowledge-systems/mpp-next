import type { Assignment } from "../model/Assignment.ts";
import type { Calendar } from "../model/Calendar.ts";
import { Duration } from "../model/Duration.ts";
import type { ProjectFile } from "../model/Project.ts";
import type { Relation } from "../model/Relation.ts";
import type { Resource } from "../model/Resource.ts";
import type { Task } from "../model/Task.ts";
import {
  ConstraintType,
  RelationType,
  ResourceType,
  TimeUnit,
  type CalendarException,
  type CalendarWeekDay,
  type ProjectProperties,
} from "../model/types.ts";
import { parseProjectDate } from "../dateTime.ts";

export class JsonReader {
  read(json: string): ProjectFile {
    const raw = JSON.parse(json) as RawProject;

    return {
      properties: parseProperties(raw.properties),
      tasks: arrayify(raw.tasks).map(parseTask),
      resources: arrayify(raw.resources).map(parseResource),
      assignments: arrayify(raw.assignments).map(parseAssignment),
      calendars: arrayify(raw.calendars).map(parseCalendar),
    };
  }
}

// --- Raw JSON shapes ---

interface RawProject {
  properties?: RawProperties;
  tasks?: RawTask[];
  resources?: RawResource[];
  assignments?: RawAssignment[];
  calendars?: RawCalendar[];
}

interface RawProperties {
  title?: string | null;
  author?: string | null;
  startDate?: string | null;
  finishDate?: string | null;
  statusDate?: string | null;
  defaultCalendarUniqueId?: number | null;
  minutesPerDay?: number;
  minutesPerWeek?: number;
  daysPerMonth?: number;
  saveVersion?: number | null;
}

interface RawDuration {
  duration: number;
  units: string;
}

interface RawTask {
  id?: number | null;
  uniqueId?: number | null;
  name?: string | null;
  wbs?: string | null;
  outlineLevel?: number | null;
  start?: string | null;
  finish?: string | null;
  duration?: RawDuration | null;
  percentComplete?: number | null;
  summary?: boolean | null;
  milestone?: boolean | null;
  critical?: boolean | null;
  notes?: string | null;
  priority?: number | null;
  cost?: number | null;
  work?: RawDuration | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  baselineStart?: string | null;
  baselineFinish?: string | null;
  baselineDuration?: RawDuration | null;
  actualWork?: RawDuration | null;
  constraintType?: string | null;
  freeSlack?: RawDuration | null;
  totalSlack?: RawDuration | null;
  earlyStart?: string | null;
  earlyFinish?: string | null;
  lateStart?: string | null;
  lateFinish?: string | null;
  levelingDelay?: RawDuration | null;
  deadline?: string | null;
  splits?: string[] | null;
  predecessors?: RawRelation[];
}

interface RawRelation {
  predecessorUniqueId?: number | null;
  successorUniqueId?: number | null;
  type?: string;
  lag?: RawDuration | null;
}

interface RawResource {
  id?: number | null;
  uniqueId?: number | null;
  name?: string | null;
  type?: string;
  email?: string | null;
  group?: string | null;
  maxUnits?: number | null;
  cost?: number | null;
  work?: RawDuration | null;
  resourcePool?: string | null;
}

interface RawAssignment {
  taskUniqueId?: number | null;
  resourceUniqueId?: number | null;
  work?: RawDuration | null;
  units?: number | null;
  start?: string | null;
  finish?: string | null;
  actualWork?: RawDuration | null;
  remainingWork?: RawDuration | null;
}

interface RawCalendar {
  uniqueId?: number | null;
  name?: string | null;
  weekDays?: RawWeekDay[];
  exceptions?: RawException[];
}

interface RawWeekDay {
  dayType?: number;
  working?: boolean;
  workingTimes?: Array<{ from?: string; to?: string }>;
}

interface RawException {
  name?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  working?: boolean | null;
}

// --- Parsers ---

function parseProperties(raw?: RawProperties): ProjectProperties {
  return {
    title: raw?.title ?? null,
    author: raw?.author ?? null,
    startDate: parseDate(raw?.startDate),
    finishDate: parseDate(raw?.finishDate),
    statusDate: parseDate(raw?.statusDate),
    defaultCalendarUniqueId: raw?.defaultCalendarUniqueId ?? null,
    minutesPerDay: raw?.minutesPerDay ?? 480,
    minutesPerWeek: raw?.minutesPerWeek ?? 2400,
    daysPerMonth: raw?.daysPerMonth ?? 20,
    saveVersion: raw?.saveVersion ?? null,
  };
}

function parseTask(raw: RawTask): Task {
  return {
    id: raw.id ?? null,
    uniqueId: raw.uniqueId ?? null,
    name: raw.name ?? null,
    wbs: raw.wbs ?? null,
    outlineLevel: raw.outlineLevel ?? null,
    start: parseDate(raw.start),
    finish: parseDate(raw.finish),
    duration: parseDuration(raw.duration),
    percentComplete: raw.percentComplete ?? null,
    summary: raw.summary ?? null,
    milestone: raw.milestone ?? null,
    critical: raw.critical ?? null,
    notes: raw.notes ?? null,
    priority: raw.priority ?? null,
    cost: raw.cost ?? null,
    work: parseDuration(raw.work),
    actualStart: parseDate(raw.actualStart),
    actualFinish: parseDate(raw.actualFinish),
    baselineStart: parseDate(raw.baselineStart),
    baselineFinish: parseDate(raw.baselineFinish),
    baselineDuration: parseDuration(raw.baselineDuration),
    actualWork: parseDuration(raw.actualWork),
    constraintType: parseConstraintType(raw.constraintType),
    freeSlack: parseDuration(raw.freeSlack),
    totalSlack: parseDuration(raw.totalSlack),
    earlyStart: parseDate(raw.earlyStart),
    earlyFinish: parseDate(raw.earlyFinish),
    lateStart: parseDate(raw.lateStart),
    lateFinish: parseDate(raw.lateFinish),
    levelingDelay: parseDuration(raw.levelingDelay),
    deadline: parseDate(raw.deadline),
    splits: raw.splits ? raw.splits.map((s) => new Date(s)) : null,
    predecessors: arrayify(raw.predecessors).map(parseRelation),
  };
}

function parseResource(raw: RawResource): Resource {
  return {
    id: raw.id ?? null,
    uniqueId: raw.uniqueId ?? null,
    name: raw.name ?? null,
    type: parseResourceType(raw.type),
    email: raw.email ?? null,
    group: raw.group ?? null,
    maxUnits: raw.maxUnits ?? null,
    cost: raw.cost ?? null,
    work: parseDuration(raw.work),
    resourcePool: raw.resourcePool ?? null,
  };
}

function parseAssignment(raw: RawAssignment): Assignment {
  return {
    taskUniqueId: raw.taskUniqueId ?? null,
    resourceUniqueId: raw.resourceUniqueId ?? null,
    work: parseDuration(raw.work),
    units: raw.units ?? null,
    start: parseDate(raw.start),
    finish: parseDate(raw.finish),
    actualWork: parseDuration(raw.actualWork),
    remainingWork: parseDuration(raw.remainingWork),
  };
}

function parseCalendar(raw: RawCalendar): Calendar {
  return {
    uniqueId: raw.uniqueId ?? null,
    name: raw.name ?? null,
    weekDays: arrayify(raw.weekDays).map(parseWeekDay),
    exceptions: arrayify(raw.exceptions).map(parseException),
  };
}

function parseRelation(raw: RawRelation): Relation {
  return {
    predecessorUniqueId: raw.predecessorUniqueId ?? null,
    successorUniqueId: raw.successorUniqueId ?? null,
    type: parseRelationType(raw.type),
    lag: parseDuration(raw.lag),
  };
}

function parseWeekDay(raw: RawWeekDay): CalendarWeekDay {
  return {
    dayType: raw.dayType ?? 0,
    working: raw.working ?? false,
    workingTimes: arrayify(raw.workingTimes).map((wt) => ({
      from: wt.from ?? "08:00:00",
      to: wt.to ?? "17:00:00",
    })),
  };
}

function parseException(raw: RawException): CalendarException {
  return {
    name: raw.name ?? null,
    fromDate: parseDate(raw.fromDate),
    toDate: parseDate(raw.toDate),
    working: raw.working ?? null,
  };
}

// --- Helpers ---

function parseDate(raw: string | null | undefined): Date | null {
  return parseProjectDate(raw ?? null);
}

function parseDuration(raw: RawDuration | null | undefined): Duration | null {
  if (!raw) {
    return null;
  }
  return Duration.from(raw.duration, parseTimeUnit(raw.units));
}

function parseTimeUnit(raw: string): TimeUnit {
  switch (raw) {
    case TimeUnit.Minutes:
      return TimeUnit.Minutes;
    case TimeUnit.Hours:
      return TimeUnit.Hours;
    case TimeUnit.Days:
      return TimeUnit.Days;
    case TimeUnit.Weeks:
      return TimeUnit.Weeks;
    case TimeUnit.Months:
      return TimeUnit.Months;
    case TimeUnit.Percent:
      return TimeUnit.Percent;
    default:
      return TimeUnit.Hours;
  }
}

function parseRelationType(raw: string | undefined): RelationType {
  switch (raw) {
    case RelationType.FinishToStart:
      return RelationType.FinishToStart;
    case RelationType.StartToStart:
      return RelationType.StartToStart;
    case RelationType.FinishToFinish:
      return RelationType.FinishToFinish;
    case RelationType.StartToFinish:
      return RelationType.StartToFinish;
    default:
      return RelationType.FinishToStart;
  }
}

function parseResourceType(raw: string | undefined): ResourceType {
  switch (raw) {
    case ResourceType.Material:
      return ResourceType.Material;
    case ResourceType.Cost:
      return ResourceType.Cost;
    case ResourceType.Work:
    default:
      return ResourceType.Work;
  }
}

function parseConstraintType(raw: string | null | undefined): ConstraintType | null {
  if (!raw) {
    return null;
  }
  switch (raw) {
    case ConstraintType.AsSoonAsPossible:
      return ConstraintType.AsSoonAsPossible;
    case ConstraintType.AsLateAsPossible:
      return ConstraintType.AsLateAsPossible;
    case ConstraintType.MustStartOn:
      return ConstraintType.MustStartOn;
    case ConstraintType.MustFinishOn:
      return ConstraintType.MustFinishOn;
    case ConstraintType.StartNoEarlierThan:
      return ConstraintType.StartNoEarlierThan;
    case ConstraintType.StartNoLaterThan:
      return ConstraintType.StartNoLaterThan;
    case ConstraintType.FinishNoEarlierThan:
      return ConstraintType.FinishNoEarlierThan;
    case ConstraintType.FinishNoLaterThan:
      return ConstraintType.FinishNoLaterThan;
    default:
      return null;
  }
}

function arrayify<T>(value: T[] | undefined): T[] {
  return value ?? [];
}
