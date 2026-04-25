// Project ──resolveCalendar──> ResolvedProject (§9.2 / R4).
// Pure: in goes the user-facing `ProjectFile` with Date objects, out comes
// the day-indexed working value the rest of the pipeline operates on.

import type { Duration } from "../model/Duration.ts";
import { TimeUnit } from "../model/types.ts";
import type { Calendar } from "../schema/calendar.ts";
import type { ProjectFile } from "../schema/project.ts";
import type { Task } from "../schema/task.ts";

import {
  buildBitmap,
  calendarDayOffset,
  countWorkingDays,
  endOfLocalDayExclusive,
  startOfLocalDay,
} from "./calendarDays.ts";
import type {
  CalendarResolution,
  PrecedenceEdge,
  ResolvedAssignment,
  ResolvedProject,
  ResolvedTask,
  WorkingDayBitmap,
} from "./types.ts";

const HORIZON_BUFFER_DAYS = 90;

function syntheticMonFriCalendar(): Calendar {
  return {
    uniqueId: null,
    name: "Synthetic Mon–Fri",
    weekDays: [
      { dayType: 1, working: false, workingTimes: [] }, // Sun
      { dayType: 2, working: true, workingTimes: [] },
      { dayType: 3, working: true, workingTimes: [] },
      { dayType: 4, working: true, workingTimes: [] },
      { dayType: 5, working: true, workingTimes: [] },
      { dayType: 6, working: true, workingTimes: [] },
      { dayType: 7, working: false, workingTimes: [] }, // Sat
    ],
    exceptions: [],
  };
}

function pickDefaultCalendar(project: ProjectFile): Calendar {
  const id = project.properties.defaultCalendarUniqueId;
  if (id !== null) {
    const found = project.calendars.find((c) => c.uniqueId === id);
    if (found) return found;
  }
  const first = project.calendars[0];
  return first ?? syntheticMonFriCalendar();
}

function pickOrigin(project: ProjectFile): Date {
  let earliest: Date | null = project.properties.startDate
    ? startOfLocalDay(project.properties.startDate)
    : null;
  for (const t of project.tasks) {
    if (t.start) {
      const s = startOfLocalDay(t.start);
      if (!earliest || s.getTime() < earliest.getTime()) earliest = s;
    }
  }
  return earliest ?? startOfLocalDay(new Date());
}

function pickHorizon(project: ProjectFile, origin: Date): number {
  let latest: Date | null = project.properties.finishDate
    ? endOfLocalDayExclusive(project.properties.finishDate)
    : null;
  for (const t of project.tasks) {
    if (t.finish) {
      const f = endOfLocalDayExclusive(t.finish);
      if (!latest || f.getTime() > latest.getTime()) latest = f;
    }
  }
  if (!latest) return 365 + HORIZON_BUFFER_DAYS;
  return calendarDayOffset(latest, origin) + HORIZON_BUFFER_DAYS;
}

// Lag → working days. The MSPDI schema doesn't distinguish elapsed vs. working
// lag, so v1 picks the working-day interpretation (matches MS Project default
// when no `e`-prefix is present). Elapsed-lag support is deferred to v2.
function lagToWorkingDays(lag: Duration | null, minutesPerDay: number): number {
  if (!lag) return 0;
  switch (lag.unit) {
    case TimeUnit.Days:
      return Math.round(lag.value);
    case TimeUnit.Weeks:
      return Math.round(lag.value * 5);
    case TimeUnit.Hours:
      return Math.round((lag.value * 60) / minutesPerDay);
    case TimeUnit.Minutes:
      return Math.round(lag.value / minutesPerDay);
    case TimeUnit.Months:
      return Math.round(lag.value * 20);
    case TimeUnit.Percent:
      return 0;
  }
}

function resolveTask(task: Task, origin: Date, bitmap: WorkingDayBitmap): ResolvedTask {
  if (task.uniqueId === null) {
    throw new Error("resolveCalendar: task missing uniqueId");
  }
  if (!task.start || !task.finish) {
    throw new Error(`resolveCalendar: task ${String(task.uniqueId)} missing start or finish`);
  }
  const startDay = calendarDayOffset(task.start, origin);
  const finishDay = calendarDayOffset(endOfLocalDayExclusive(task.finish), origin);
  const durationDays = countWorkingDays(bitmap, startDay, finishDay);
  return {
    uniqueId: task.uniqueId,
    name: task.name,
    startDay,
    finishDay,
    durationDays,
    outlineLevel: task.outlineLevel,
    summary: task.summary ?? false,
    milestone: task.milestone ?? false,
  };
}

function resolveEdges(tasks: ReadonlyArray<Task>, minutesPerDay: number): PrecedenceEdge[] {
  const edges: PrecedenceEdge[] = [];
  for (const t of tasks) {
    if (t.uniqueId === null) continue;
    for (const r of t.predecessors) {
      if (r.predecessorUniqueId === null) continue;
      edges.push({
        predecessorUniqueId: r.predecessorUniqueId,
        successorUniqueId: t.uniqueId,
        type: r.type,
        lagDays: lagToWorkingDays(r.lag, minutesPerDay),
      });
    }
  }
  return edges;
}

function resolveAssignments(project: ProjectFile): ResolvedAssignment[] {
  const out: ResolvedAssignment[] = [];
  for (const a of project.assignments) {
    if (a.taskUniqueId === null || a.resourceUniqueId === null) continue;
    out.push({
      taskUniqueId: a.taskUniqueId,
      resourceUniqueId: a.resourceUniqueId,
      units: a.units ?? 1,
    });
  }
  return out;
}

function validateTasks(project: ProjectFile): void {
  for (const t of project.tasks) {
    if (t.uniqueId === null) {
      throw new Error("resolveCalendar: task missing uniqueId");
    }
    if (!t.start || !t.finish) {
      throw new Error(`resolveCalendar: task ${String(t.uniqueId)} missing start or finish`);
    }
  }
}

export function resolveCalendar(project: ProjectFile): ResolvedProject {
  validateTasks(project);
  const calendar = pickDefaultCalendar(project);
  const origin = pickOrigin(project);
  const numDays = pickHorizon(project, origin);
  const bitmap = buildBitmap(calendar, origin, numDays);
  const calendarResolution: CalendarResolution = {
    origin,
    bitmap,
    calendarUniqueId: calendar.uniqueId,
  };
  const tasks = project.tasks.map((t) => resolveTask(t, origin, bitmap));
  const precedences = resolveEdges(project.tasks, project.properties.minutesPerDay);
  const assignments = resolveAssignments(project);
  return {
    source: project,
    calendar: calendarResolution,
    tasks,
    assignments,
    precedences,
  };
}
