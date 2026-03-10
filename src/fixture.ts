import { Duration } from "./model/Duration.ts";
import type { Assignment } from "./model/Assignment.ts";
import type { Calendar } from "./model/Calendar.ts";
import type { ProjectFile } from "./model/Project.ts";
import type { Relation } from "./model/Relation.ts";
import type { Resource } from "./model/Resource.ts";
import type { Task } from "./model/Task.ts";
import { parseProjectDate } from "./dateTime.ts";
import { RelationType, ResourceType, type ProjectProperties } from "./model/types.ts";

interface FixtureProjectData {
  project: {
    title: string | null;
    author: string | null;
    start_date: string | null;
    finish_date: string | null;
    status_date: string | null;
  };
  tasks: FixtureTask[];
  resources: FixtureResource[];
  assignments: FixtureAssignment[];
  calendars: FixtureCalendar[];
}

interface FixtureTask {
  id: number | null;
  unique_id: number | null;
  name: string | null;
  wbs: string | null;
  outline_level: number | null;
  start: string | null;
  finish: string | null;
  duration: string | null;
  percent_complete: string | null;
  summary: boolean | null;
  milestone: boolean | null;
  critical: boolean | null;
  notes: string | null;
  priority: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  baseline_start: string | null;
  baseline_finish: string | null;
  baseline_duration: string | null;
  cost: string | null;
  work: string | null;
  predecessors: FixtureRelation[];
}

interface FixtureRelation {
  predecessor_unique_id: number | null;
  type: string | null;
  lag: string | null;
}

interface FixtureResource {
  id: number | null;
  unique_id: number | null;
  name: string | null;
  type: string | null;
  email: string | null;
  group: string | null;
  max_units: string | null;
  cost: string | null;
}

interface FixtureAssignment {
  task_unique_id: number | null;
  resource_unique_id: number | null;
  work: string | null;
  units: string | null;
  start: string | null;
  finish: string | null;
}

interface FixtureCalendar {
  unique_id: number | null;
  name: string | null;
}

export function projectFromFixtureData(data: FixtureProjectData): ProjectFile {
  return {
    properties: mapProperties(data.project),
    tasks: data.tasks.map(mapTask),
    resources: data.resources.map(mapResource),
    assignments: data.assignments.map(mapAssignment),
    calendars: data.calendars.map(mapCalendar),
  };
}

export function projectFromFixtureJson(json: string): ProjectFile {
  return projectFromFixtureData(JSON.parse(json) as FixtureProjectData);
}

function mapProperties(input: FixtureProjectData["project"]): ProjectProperties {
  return {
    title: input.title,
    author: input.author,
    startDate: parseDate(input.start_date),
    finishDate: parseDate(input.finish_date),
    statusDate: parseDate(input.status_date),
    defaultCalendarUniqueId: null,
    minutesPerDay: 480,
    minutesPerWeek: 2400,
    daysPerMonth: 20,
    saveVersion: null,
  };
}

function mapTask(input: FixtureTask): Task {
  return {
    id: input.id,
    uniqueId: input.unique_id,
    name: input.name,
    wbs: input.wbs,
    outlineLevel: input.outline_level,
    start: parseDate(input.start),
    finish: parseDate(input.finish),
    duration: Duration.parseSimple(input.duration),
    percentComplete: parseNumber(input.percent_complete),
    summary: input.summary,
    milestone: input.milestone,
    critical: input.critical,
    notes: input.notes,
    priority: parsePriority(input.priority),
    cost: parseNumber(input.cost),
    work: Duration.parseSimple(input.work),
    actualStart: parseDate(input.actual_start),
    actualFinish: parseDate(input.actual_finish),
    baselineStart: parseDate(input.baseline_start),
    baselineFinish: parseDate(input.baseline_finish),
    baselineDuration: Duration.parseSimple(input.baseline_duration),
    constraintType: null,
    freeSlack: null,
    totalSlack: null,
    earlyStart: null,
    earlyFinish: null,
    lateStart: null,
    lateFinish: null,
    levelingDelay: null,
    deadline: null,
    splits: null,
    predecessors: input.predecessors.map((predecessor) =>
      mapRelation(predecessor, input.unique_id),
    ),
  };
}

function mapRelation(input: FixtureRelation, successorUniqueId: number | null): Relation {
  return {
    predecessorUniqueId: input.predecessor_unique_id,
    successorUniqueId,
    type: parseRelationType(input.type),
    lag: Duration.parseSimple(input.lag),
  };
}

function mapResource(input: FixtureResource): Resource {
  return {
    id: input.id,
    uniqueId: input.unique_id,
    name: input.name,
    type: parseResourceType(input.type),
    email: input.email,
    group: input.group,
    maxUnits: parseNumber(input.max_units),
    cost: parseNumber(input.cost),
    work: null,
    resourcePool: null,
  };
}

function mapAssignment(input: FixtureAssignment): Assignment {
  return {
    taskUniqueId: input.task_unique_id,
    resourceUniqueId: input.resource_unique_id,
    work: Duration.parseSimple(input.work),
    units: parseNumber(input.units),
    start: parseDate(input.start),
    finish: parseDate(input.finish),
    actualWork: null,
    remainingWork: null,
  };
}

function mapCalendar(input: FixtureCalendar): Calendar {
  return {
    uniqueId: input.unique_id,
    name: input.name,
    weekDays: [],
    exceptions: [],
  };
}

function parseDate(raw: string | null): Date | null {
  return parseProjectDate(raw);
}

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw === "") {
    return null;
  }
  const value = Number(raw.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function parsePriority(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const match = /value=(\d+)/.exec(raw);
  return match ? Number(match[1]) : parseNumber(raw);
}

function parseRelationType(raw: string | null): RelationType {
  switch (raw) {
    case "START_START":
    case "SS":
      return RelationType.StartToStart;
    case "FINISH_FINISH":
    case "FF":
      return RelationType.FinishToFinish;
    case "START_FINISH":
    case "SF":
      return RelationType.StartToFinish;
    case "FINISH_START":
    case "FS":
    default:
      return RelationType.FinishToStart;
  }
}

function parseResourceType(raw: string | null): ResourceType {
  switch (raw) {
    case "Material":
      return ResourceType.Material;
    case "Cost":
      return ResourceType.Cost;
    case "Work":
    default:
      return ResourceType.Work;
  }
}
