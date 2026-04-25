// Schedule ──materialize──> ProjectFile (§9.2).
// Carries forward every source field except the ones the schedule decides
// (start, finish, duration). Tasks that don't appear in `schedule.tasks`
// pass through unchanged — useful when only a subset of tasks were
// scheduled (e.g. mid-pipeline partial schedules).

import { Duration } from "../model/Duration.ts";
import { TimeUnit } from "../model/types.ts";
import type { ProjectFile } from "../schema/project.ts";
import type { Task } from "../schema/task.ts";

import { countWorkingDays, dayIndexToDate } from "./calendarDays.ts";
import type { CalendarResolution, Schedule, ScheduledTask } from "./types.ts";

function workingDaysToDuration(
  workingDays: number,
  original: Duration | null,
  minutesPerDay: number,
): Duration | null {
  if (!original) return Duration.from(workingDays, TimeUnit.Days);
  switch (original.unit) {
    case TimeUnit.Days:
      return Duration.from(workingDays, TimeUnit.Days);
    case TimeUnit.Weeks:
      return Duration.from(workingDays / 5, TimeUnit.Weeks);
    case TimeUnit.Hours:
      return Duration.from((workingDays * minutesPerDay) / 60, TimeUnit.Hours);
    case TimeUnit.Minutes:
      return Duration.from(workingDays * minutesPerDay, TimeUnit.Minutes);
    case TimeUnit.Months:
      return Duration.from(workingDays / 20, TimeUnit.Months);
    case TimeUnit.Percent:
      return original;
  }
}

function applyScheduledTask(
  task: Task,
  scheduled: ScheduledTask,
  calendar: CalendarResolution,
  minutesPerDay: number,
): Task {
  if (scheduled.modeId !== null) {
    throw new Error(`materialize: mode-change tasks are v2 (task ${String(task.uniqueId)})`);
  }
  const workingDays = countWorkingDays(calendar.bitmap, scheduled.startDay, scheduled.finishDay);
  return {
    ...task,
    start: dayIndexToDate(scheduled.startDay, calendar.origin),
    finish: dayIndexToDate(scheduled.finishDay, calendar.origin),
    duration: workingDaysToDuration(workingDays, task.duration, minutesPerDay),
  };
}

export function materialize(schedule: Schedule): ProjectFile {
  const source = schedule.resolved.source;
  const calendar = schedule.resolved.calendar;
  const minutesPerDay = source.properties.minutesPerDay;

  const byUniqueId = new Map<number, ScheduledTask>();
  for (const t of schedule.tasks) byUniqueId.set(t.uniqueId, t);

  const tasks = source.tasks.map((task) => {
    if (task.uniqueId === null) return task;
    const scheduled = byUniqueId.get(task.uniqueId);
    if (!scheduled) return task;
    return applyScheduledTask(task, scheduled, calendar, minutesPerDay);
  });

  return { ...source, tasks };
}
