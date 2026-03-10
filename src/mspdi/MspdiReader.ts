import { XMLParser } from "fast-xml-parser";

import type { Assignment } from "../model/Assignment.ts";
import type { Calendar } from "../model/Calendar.ts";
import { createEmptyProject, type ProjectFile } from "../model/Project.ts";
import type { Relation } from "../model/Relation.ts";
import type { Resource } from "../model/Resource.ts";
import type { Task } from "../model/Task.ts";
import { parseProjectDate } from "../dateTime.ts";
import {
  RelationType,
  ResourceType,
  type CalendarException,
  type CalendarWeekDay,
} from "../model/types.ts";
import { durationContextFromProject, parseLinkLag, parseXsdDuration } from "./XsdDuration.ts";

interface ProjectNode {
  SaveVersion?: string;
  Title?: string;
  Author?: string;
  StartDate?: string;
  FinishDate?: string;
  StatusDate?: string;
  CalendarUID?: string;
  MinutesPerDay?: string;
  MinutesPerWeek?: string;
  DaysPerMonth?: string;
  Calendars?: { Calendar?: CalendarNode | CalendarNode[] };
  Tasks?: { Task?: TaskNode | TaskNode[] };
  Resources?: { Resource?: ResourceNode | ResourceNode[] };
  Assignments?: { Assignment?: AssignmentNode | AssignmentNode[] };
}

interface CalendarNode {
  UID?: string;
  Name?: string;
  WeekDays?: { WeekDay?: WeekDayNode | WeekDayNode[] };
  Exceptions?: { Exception?: ExceptionNode | ExceptionNode[] };
}

interface WeekDayNode {
  DayType?: string;
  DayWorking?: string;
  WorkingTimes?: { WorkingTime?: WorkingTimeNode | WorkingTimeNode[] };
}

interface WorkingTimeNode {
  FromTime?: string;
  ToTime?: string;
}

interface ExceptionNode {
  Name?: string;
  FromDate?: string;
  ToDate?: string;
  Working?: string;
}

interface TaskNode {
  UID?: string;
  ID?: string;
  Name?: string;
  WBS?: string;
  OutlineLevel?: string;
  Start?: string;
  Finish?: string;
  Duration?: string;
  PercentComplete?: string;
  Summary?: string;
  Milestone?: string;
  Critical?: string;
  Notes?: string;
  Priority?: string;
  Cost?: string;
  Work?: string;
  ActualStart?: string;
  ActualFinish?: string;
  BaselineStart?: string;
  BaselineFinish?: string;
  BaselineDuration?: string;
  PredecessorLink?: PredecessorNode | PredecessorNode[];
}

interface PredecessorNode {
  PredecessorUID?: string;
  Type?: string;
  LinkLag?: string;
  LagFormat?: string;
}

interface ResourceNode {
  UID?: string;
  ID?: string;
  Name?: string;
  Type?: string;
  EmailAddress?: string;
  Group?: string;
  MaxUnits?: string;
  Cost?: string;
  Work?: string;
}

interface AssignmentNode {
  TaskUID?: string;
  ResourceUID?: string;
  Work?: string;
  Units?: string;
  Start?: string;
  Finish?: string;
}

export class MspdiReader {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });

  read(xml: string): ProjectFile {
    const parsed = this.parser.parse(xml) as { Project?: ProjectNode };
    const root = parsed.Project;
    if (!root) {
      throw new Error("MSPDI XML is missing the Project root element");
    }

    const project = createEmptyProject();
    project.properties = {
      saveVersion: parseNumber(root.SaveVersion),
      title: nullIfEmpty(root.Title),
      author: nullIfEmpty(root.Author),
      startDate: parseDate(root.StartDate),
      finishDate: parseDate(root.FinishDate),
      statusDate: parseDate(root.StatusDate),
      defaultCalendarUniqueId: parseNumber(root.CalendarUID),
      minutesPerDay: parseNumber(root.MinutesPerDay) ?? 480,
      minutesPerWeek: parseNumber(root.MinutesPerWeek) ?? 2400,
      daysPerMonth: parseNumber(root.DaysPerMonth) ?? 20,
    };

    const durationContext = durationContextFromProject(project.properties);

    project.calendars = arrayify(root.Calendars?.Calendar).map((calendar) =>
      this.parseCalendar(calendar),
    );
    project.tasks = arrayify(root.Tasks?.Task).map((task) => this.parseTask(task, durationContext));
    project.resources = arrayify(root.Resources?.Resource).map((resource) =>
      this.parseResource(resource, durationContext),
    );
    project.assignments = arrayify(root.Assignments?.Assignment).map((assignment) =>
      this.parseAssignment(assignment, durationContext),
    );

    return project;
  }

  private parseCalendar(node: CalendarNode): Calendar {
    return {
      uniqueId: parseNumber(node.UID),
      name: nullIfEmpty(node.Name),
      weekDays: arrayify(node.WeekDays?.WeekDay).map((weekDay) => this.parseWeekDay(weekDay)),
      exceptions: arrayify(node.Exceptions?.Exception).map((exception) =>
        this.parseException(exception),
      ),
    };
  }

  private parseWeekDay(node: WeekDayNode): CalendarWeekDay {
    return {
      dayType: parseNumber(node.DayType) ?? 0,
      working: parseBool(node.DayWorking) ?? false,
      workingTimes: arrayify(node.WorkingTimes?.WorkingTime).map((workingTime) => ({
        from: nullIfEmpty(workingTime.FromTime) ?? "08:00:00",
        to: nullIfEmpty(workingTime.ToTime) ?? "17:00:00",
      })),
    };
  }

  private parseException(node: ExceptionNode): CalendarException {
    return {
      name: nullIfEmpty(node.Name),
      fromDate: parseDate(node.FromDate),
      toDate: parseDate(node.ToDate),
      working: parseBool(node.Working),
    };
  }

  private parseTask(
    node: TaskNode,
    durationContext: ReturnType<typeof durationContextFromProject>,
  ): Task {
    const uid = parseNumber(node.UID);
    const predecessors: Relation[] = arrayify(node.PredecessorLink).map((link) => ({
      predecessorUniqueId: parseNumber(link.PredecessorUID),
      successorUniqueId: uid,
      type: parseRelationType(link.Type),
      lag: parseLinkLag(link.LinkLag, link.LagFormat, durationContext),
    }));

    return {
      id: parseNumber(node.ID),
      uniqueId: uid,
      name: nullIfEmpty(node.Name),
      wbs: nullIfEmpty(node.WBS),
      outlineLevel: parseNumber(node.OutlineLevel),
      start: parseDate(node.Start),
      finish: parseDate(node.Finish),
      duration: parseXsdDuration(node.Duration, durationContext),
      percentComplete: parseNumber(node.PercentComplete),
      summary: parseBool(node.Summary),
      milestone: parseBool(node.Milestone),
      critical: parseBool(node.Critical),
      notes: nullIfEmpty(node.Notes),
      priority: parseNumber(node.Priority),
      cost: parseNumber(node.Cost),
      work: parseXsdDuration(node.Work, durationContext),
      actualStart: parseDate(node.ActualStart),
      actualFinish: parseDate(node.ActualFinish),
      baselineStart: parseDate(node.BaselineStart),
      baselineFinish: parseDate(node.BaselineFinish),
      baselineDuration: parseXsdDuration(node.BaselineDuration, durationContext),
      constraintType: null,
      predecessors,
    };
  }

  private parseResource(
    node: ResourceNode,
    durationContext: ReturnType<typeof durationContextFromProject>,
  ): Resource {
    return {
      id: parseNumber(node.ID),
      uniqueId: parseNumber(node.UID),
      name: nullIfEmpty(node.Name),
      type: parseResourceType(node.Type),
      email: nullIfEmpty(node.EmailAddress),
      group: nullIfEmpty(node.Group),
      maxUnits: parseUnits(node.MaxUnits),
      cost: parseNumber(node.Cost),
      work: parseXsdDuration(node.Work, durationContext),
    };
  }

  private parseAssignment(
    node: AssignmentNode,
    durationContext: ReturnType<typeof durationContextFromProject>,
  ): Assignment {
    return {
      taskUniqueId: parseNumber(node.TaskUID),
      resourceUniqueId: parseNumber(node.ResourceUID),
      work: parseXsdDuration(node.Work, durationContext),
      units: parseUnits(node.Units),
      start: parseDate(node.Start),
      finish: parseDate(node.Finish),
    };
  }
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function nullIfEmpty(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

function parseDate(raw: string | undefined): Date | null {
  return parseProjectDate(raw ?? null);
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseUnits(raw: string | undefined): number | null {
  const value = parseNumber(raw);
  return value === null ? null : value * 100;
}

function parseBool(raw: string | undefined): boolean | null {
  if (raw === undefined) {
    return null;
  }
  if (raw === "1" || raw.toLowerCase() === "true") {
    return true;
  }
  if (raw === "0" || raw.toLowerCase() === "false") {
    return false;
  }
  return null;
}

function parseRelationType(raw: string | undefined): RelationType {
  switch (raw) {
    case "1":
    case RelationType.StartToStart:
      return RelationType.StartToStart;
    case "2":
    case RelationType.FinishToFinish:
      return RelationType.FinishToFinish;
    case "3":
    case RelationType.StartToFinish:
      return RelationType.StartToFinish;
    case "0":
    case undefined:
    case RelationType.FinishToStart:
    default:
      return RelationType.FinishToStart;
  }
}

function parseResourceType(raw: string | undefined): ResourceType {
  switch (raw) {
    case "0":
    case ResourceType.Material:
      return ResourceType.Material;
    case "2":
    case ResourceType.Cost:
      return ResourceType.Cost;
    case "1":
    case undefined:
    case ResourceType.Work:
    default:
      return ResourceType.Work;
  }
}
