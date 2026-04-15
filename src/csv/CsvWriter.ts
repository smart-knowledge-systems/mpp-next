import type { ProjectFile } from "../model/Project.ts";
import { formatProjectDate } from "../dateTime.ts";

export interface CsvWriterOptions {
  /** Include summary (parent) tasks. Default: false (leaf tasks only). */
  includeSummaryTasks?: boolean;
  /** Include a Resources column resolved from assignments. Default: true. */
  includeResources?: boolean;
}

const HEADERS_BASE = [
  "ID",
  "Task Name",
  "WBS",
  "Start",
  "Finish",
  "Duration",
  "% Complete",
  "Critical",
  "Milestone",
];

export class CsvWriter {
  write(project: ProjectFile, options?: CsvWriterOptions): string {
    const includeSummary = options?.includeSummaryTasks === true;
    const includeResources = options?.includeResources !== false;

    const headers = includeResources ? [...HEADERS_BASE, "Resources"] : [...HEADERS_BASE];

    // Build resource lookup: uniqueId → name
    const resourceNames = new Map<number, string>();
    for (const resource of project.resources) {
      if (resource.uniqueId !== null && resource.name !== null) {
        resourceNames.set(resource.uniqueId, resource.name);
      }
    }

    // Build task → resource names lookup via assignments
    const taskResources = new Map<number, string[]>();
    for (const assignment of project.assignments) {
      if (assignment.taskUniqueId === null || assignment.resourceUniqueId === null) continue;
      const name = resourceNames.get(assignment.resourceUniqueId);
      if (!name) continue;
      const existing = taskResources.get(assignment.taskUniqueId);
      if (existing) {
        if (!existing.includes(name)) existing.push(name);
      } else {
        taskResources.set(assignment.taskUniqueId, [name]);
      }
    }

    const tasks = includeSummary
      ? project.tasks.filter((t) => t.id !== null)
      : project.tasks.filter((t) => t.summary === false && t.id !== null);

    const lines = [headers.map(escapeField).join(",")];

    for (const task of tasks) {
      const fields: unknown[] = [
        task.id,
        task.name,
        task.wbs,
        formatProjectDate(task.start),
        formatProjectDate(task.finish),
        task.duration?.toSimpleString() ?? null,
        task.percentComplete,
        task.critical ? "Yes" : "No",
        task.milestone ? "Yes" : "No",
      ];

      if (includeResources) {
        const names = task.uniqueId !== null ? taskResources.get(task.uniqueId) : undefined;
        fields.push(names ? names.join(",") : null);
      }

      lines.push(fields.map(escapeField).join(","));
    }

    return lines.join("\n") + "\n";
  }
}

function escapeField(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
