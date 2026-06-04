// Schedule ──materialize──> ProjectFile.
// Carries forward every source field except the ones the schedule decides
// (start, finish, duration). Tasks that don't appear in `schedule.tasks`
// pass through unchanged — useful when only a subset of tasks were
// scheduled (e.g. mid-pipeline partial schedules).

import { Duration } from "../model/Duration.ts";
import { TimeUnit } from "../model/types.ts";
import type { ProjectFile, ProjectProperties } from "../schema/project.ts";
import type { Task } from "../schema/task.ts";

import { countWorkingDays, dayToDate, resolveWorkingCalendar } from "./calendarDays.ts";
import type { Schedule, ScheduledTask, WorkingCalendar } from "./types.ts";

function workingDaysPerWeek(properties: ProjectProperties): number {
  const wpd = properties.minutesPerDay;
  const wpw = properties.minutesPerWeek;
  if (wpd <= 0 || wpw <= 0) return 5;
  return wpw / wpd;
}

// Re-emit duration in the original unit using properties-derived
// conversions; falls back to Days when the source had no unit.
function workingDaysToDuration(
  workingDays: number,
  original: Duration | null,
  properties: ProjectProperties,
): Duration | null {
  if (!original) return Duration.from(workingDays, TimeUnit.Days);
  const minutesPerDay = properties.minutesPerDay;
  const wpw = workingDaysPerWeek(properties);
  const dpm = properties.daysPerMonth;
  switch (original.unit) {
    case TimeUnit.Days:
      return Duration.from(workingDays, TimeUnit.Days);
    case TimeUnit.Weeks:
      return Duration.from(wpw > 0 ? workingDays / wpw : workingDays, TimeUnit.Weeks);
    case TimeUnit.Hours:
      return Duration.from((workingDays * minutesPerDay) / 60, TimeUnit.Hours);
    case TimeUnit.Minutes:
      return Duration.from(workingDays * minutesPerDay, TimeUnit.Minutes);
    case TimeUnit.Months:
      return Duration.from(dpm > 0 ? workingDays / dpm : workingDays, TimeUnit.Months);
    case TimeUnit.Percent:
      return original;
  }
}

function applyScheduledTask(
  task: Task,
  scheduled: ScheduledTask,
  cal: WorkingCalendar,
  properties: ProjectProperties,
): Task {
  if (scheduled.modeId !== null) {
    throw new Error(
      `materialize: mode-change tasks are not yet supported (task ${String(task.uniqueId)})`,
    );
  }
  const workingDays = countWorkingDays(cal, scheduled.startDay, scheduled.finishDay);
  return {
    ...task,
    start: dayToDate(cal, scheduled.startDay),
    finish: dayToDate(cal, scheduled.finishDay),
    duration: workingDaysToDuration(workingDays, task.duration, properties),
  };
}

export function materialize(schedule: Schedule): ProjectFile {
  const source = schedule.resolved.source;
  const properties = source.properties;

  const byUniqueId = new Map<number, ScheduledTask>();
  for (const t of schedule.tasks) byUniqueId.set(t.uniqueId, t);
  const resolvedTaskById = new Map(schedule.resolved.tasks.map((t) => [t.uniqueId, t]));

  const tasks = source.tasks.map((task) => {
    if (task.uniqueId === null) return task;
    const scheduled = byUniqueId.get(task.uniqueId);
    if (!scheduled) return task;
    const cal = resolveWorkingCalendar(
      schedule.resolved,
      resolvedTaskById.get(task.uniqueId)?.calendarUniqueId ?? null,
    );
    return applyScheduledTask(task, scheduled, cal, properties);
  });

  return { ...source, tasks };
}
