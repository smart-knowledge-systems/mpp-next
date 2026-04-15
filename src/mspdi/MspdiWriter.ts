import type { Assignment } from "../model/Assignment.ts";
import type { Calendar } from "../model/Calendar.ts";
import type { ProjectFile } from "../model/Project.ts";
import type { Resource } from "../model/Resource.ts";
import type { Task } from "../model/Task.ts";
import { formatProjectDate } from "../dateTime.ts";
import { RelationType, ResourceType } from "../model/types.ts";
import { durationContextFromProject, formatLinkLag, formatXsdDuration } from "./XsdDuration.ts";

export interface MspdiWriterOptions {
  saveVersion?: number;
}

export class MspdiWriter {
  write(project: ProjectFile, options: MspdiWriterOptions = {}): string {
    const saveVersion = options.saveVersion ?? 14;
    const durationContext = durationContextFromProject(project.properties);
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Project xmlns="http://schemas.microsoft.com/project">',
      tag("SaveVersion", String(saveVersion), 1),
      tag("Title", project.properties.title, 1),
      tag("Author", project.properties.author, 1),
      tag("StartDate", formatProjectDate(project.properties.startDate), 1),
      tag("FinishDate", formatProjectDate(project.properties.finishDate), 1),
      tag("StatusDate", formatProjectDate(project.properties.statusDate), 1),
      tag("MinutesPerDay", nullableNumber(project.properties.minutesPerDay), 1),
      tag("MinutesPerWeek", nullableNumber(project.properties.minutesPerWeek), 1),
      tag("DaysPerMonth", nullableNumber(project.properties.daysPerMonth), 1),
      tag("CalendarUID", nullableNumber(project.properties.defaultCalendarUniqueId), 1),
      "  <Calendars>",
      ...project.calendars.flatMap((calendar) => this.writeCalendar(calendar)),
      "  </Calendars>",
      "  <Tasks>",
      ...project.tasks.flatMap((task) => this.writeTask(task, durationContext)),
      "  </Tasks>",
      "  <Resources>",
      ...project.resources.flatMap((resource) => this.writeResource(resource, durationContext)),
      "  </Resources>",
      "  <Assignments>",
      ...project.assignments.flatMap((assignment) =>
        this.writeAssignment(assignment, durationContext),
      ),
      "  </Assignments>",
      "</Project>",
    ];

    return lines.filter(Boolean).join("\n");
  }

  private writeCalendar(calendar: Calendar): string[] {
    const lines = ["    <Calendar>"];
    lines.push(tag("UID", nullableNumber(calendar.uniqueId), 3));
    lines.push(tag("Name", calendar.name, 3));

    if (calendar.weekDays.length > 0) {
      lines.push("      <WeekDays>");
      for (const weekDay of calendar.weekDays) {
        lines.push("        <WeekDay>");
        lines.push(tag("DayType", String(weekDay.dayType), 5));
        lines.push(tag("DayWorking", weekDay.working ? "1" : "0", 5));
        if (weekDay.workingTimes.length > 0) {
          lines.push("          <WorkingTimes>");
          for (const workingTime of weekDay.workingTimes) {
            lines.push("            <WorkingTime>");
            lines.push(tag("FromTime", workingTime.from, 7));
            lines.push(tag("ToTime", workingTime.to, 7));
            lines.push("            </WorkingTime>");
          }
          lines.push("          </WorkingTimes>");
        }
        lines.push("        </WeekDay>");
      }
      lines.push("      </WeekDays>");
    }

    if (calendar.exceptions.length > 0) {
      lines.push("      <Exceptions>");
      for (const exception of calendar.exceptions) {
        lines.push("        <Exception>");
        lines.push(tag("Name", exception.name, 5));
        lines.push(tag("FromDate", formatProjectDate(exception.fromDate), 5));
        lines.push(tag("ToDate", formatProjectDate(exception.toDate), 5));
        if (exception.working !== null) {
          lines.push(tag("Working", exception.working ? "1" : "0", 5));
        }
        lines.push("        </Exception>");
      }
      lines.push("      </Exceptions>");
    }

    lines.push("    </Calendar>");
    return lines;
  }

  private writeTask(
    task: Task,
    durationContext: ReturnType<typeof durationContextFromProject>,
  ): string[] {
    const lines = ["    <Task>"];
    lines.push(tag("UID", nullableNumber(task.uniqueId), 3));
    lines.push(tag("ID", nullableNumber(task.id), 3));
    lines.push(tag("Name", task.name, 3));
    lines.push(tag("WBS", task.wbs, 3));
    lines.push(tag("OutlineLevel", nullableNumber(task.outlineLevel), 3));
    lines.push(tag("Start", formatProjectDate(task.start), 3));
    lines.push(tag("Finish", formatProjectDate(task.finish), 3));
    lines.push(tag("Duration", formatXsdDuration(task.duration, durationContext), 3));
    lines.push(tag("Work", formatXsdDuration(task.work, durationContext), 3));
    lines.push(tag("ActualWork", formatXsdDuration(task.actualWork, durationContext), 3));
    lines.push(tag("PercentComplete", nullableNumber(task.percentComplete), 3));
    lines.push(tag("Summary", formatBoolean(task.summary), 3));
    lines.push(tag("Milestone", formatBoolean(task.milestone), 3));
    lines.push(tag("Critical", formatBoolean(task.critical), 3));
    lines.push(tag("Notes", task.notes, 3));
    lines.push(tag("Priority", nullableNumber(task.priority), 3));
    lines.push(tag("Cost", nullableNumber(task.cost), 3));
    lines.push(tag("ActualStart", formatProjectDate(task.actualStart), 3));
    lines.push(tag("ActualFinish", formatProjectDate(task.actualFinish), 3));
    lines.push(tag("BaselineStart", formatProjectDate(task.baselineStart), 3));
    lines.push(tag("BaselineFinish", formatProjectDate(task.baselineFinish), 3));
    lines.push(
      tag("BaselineDuration", formatXsdDuration(task.baselineDuration, durationContext), 3),
    );
    lines.push(tag("FreeSlack", formatXsdDuration(task.freeSlack, durationContext), 3));
    lines.push(tag("TotalSlack", formatXsdDuration(task.totalSlack, durationContext), 3));
    lines.push(tag("EarlyStart", formatProjectDate(task.earlyStart), 3));
    lines.push(tag("EarlyFinish", formatProjectDate(task.earlyFinish), 3));
    lines.push(tag("LateStart", formatProjectDate(task.lateStart), 3));
    lines.push(tag("LateFinish", formatProjectDate(task.lateFinish), 3));
    lines.push(tag("LevelingDelay", formatXsdDuration(task.levelingDelay, durationContext), 3));
    lines.push(tag("Deadline", formatProjectDate(task.deadline), 3));
    for (const predecessor of task.predecessors) {
      const lag = formatLinkLag(predecessor.lag, durationContext);
      lines.push("      <PredecessorLink>");
      lines.push(tag("PredecessorUID", nullableNumber(predecessor.predecessorUniqueId), 4));
      lines.push(tag("Type", formatRelationType(predecessor.type), 4));
      lines.push(tag("LinkLag", lag.linkLag, 4));
      lines.push(tag("LagFormat", lag.lagFormat, 4));
      lines.push("      </PredecessorLink>");
    }
    lines.push("    </Task>");
    return lines;
  }

  private writeResource(
    resource: Resource,
    durationContext: ReturnType<typeof durationContextFromProject>,
  ): string[] {
    return [
      "    <Resource>",
      tag("UID", nullableNumber(resource.uniqueId), 3),
      tag("ID", nullableNumber(resource.id), 3),
      tag("Name", resource.name, 3),
      tag("Type", formatResourceType(resource.type), 3),
      tag("EmailAddress", resource.email, 3),
      tag("Group", resource.group, 3),
      tag("MaxUnits", formatUnits(resource.maxUnits), 3),
      tag("Cost", nullableNumber(resource.cost), 3),
      tag("Work", formatXsdDuration(resource.work, durationContext), 3),
      "    </Resource>",
    ];
  }

  private writeAssignment(
    assignment: Assignment,
    durationContext: ReturnType<typeof durationContextFromProject>,
  ): string[] {
    return [
      "    <Assignment>",
      tag("TaskUID", nullableNumber(assignment.taskUniqueId), 3),
      tag("ResourceUID", nullableNumber(assignment.resourceUniqueId), 3),
      tag("Work", formatXsdDuration(assignment.work, durationContext), 3),
      tag("Units", formatUnits(assignment.units), 3),
      tag("Start", formatProjectDate(assignment.start), 3),
      tag("Finish", formatProjectDate(assignment.finish), 3),
      tag("ActualWork", formatXsdDuration(assignment.actualWork, durationContext), 3),
      tag("RemainingWork", formatXsdDuration(assignment.remainingWork, durationContext), 3),
      "    </Assignment>",
    ];
  }
}

function tag(name: string, value: string | null, indentLevel: number): string {
  if (value === null || value === "") {
    return "";
  }
  const indent = "  ".repeat(indentLevel);
  return `${indent}<${name}>${escapeXml(value)}</${name}>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatBoolean(value: boolean | null): string | null {
  return value === null ? null : value ? "1" : "0";
}

function nullableNumber(value: number | null): string | null {
  return value === null ? null : String(value);
}

function formatUnits(value: number | null): string | null {
  return value === null ? null : String(value / 100);
}

function formatRelationType(type: RelationType): string {
  switch (type) {
    case RelationType.StartToStart:
      return "1";
    case RelationType.FinishToFinish:
      return "2";
    case RelationType.StartToFinish:
      return "3";
    case RelationType.FinishToStart:
    default:
      return "0";
  }
}

function formatResourceType(type: ResourceType): string {
  switch (type) {
    case ResourceType.Material:
      return "0";
    case ResourceType.Cost:
      return "2";
    case ResourceType.Work:
    default:
      return "1";
  }
}
