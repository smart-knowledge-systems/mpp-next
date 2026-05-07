// D3: bridge for the no-search-yet case. Reads pre-existing dates from
// `resolved.source` into a Schedule shape so round-trip identity holds for
// projects that already have task dates pinned, and so partial pipelines
// can hand a Schedule to materialize() without going through Search.

import { dateToDay, endOfLocalDayExclusive, startOfLocalDay } from "./calendarDays.ts";
import type { ResolvedProject, Schedule, ScheduledTask, WorkingCalendar } from "./types.ts";

function calendarFor(resolved: ResolvedProject, taskUniqueId: number): WorkingCalendar {
  const task = resolved.tasks.find((t) => t.uniqueId === taskUniqueId);
  const id = task?.calendarUniqueId ?? resolved.defaultCalendarUniqueId;
  if (id !== null) {
    const cal = resolved.calendars.get(id);
    if (cal) return cal;
  }
  const fallback = resolved.calendars.values().next().value;
  if (!fallback) {
    throw new Error("currentSchedule: ResolvedProject has no calendars");
  }
  return fallback;
}

export function currentSchedule(resolved: ResolvedProject): Schedule {
  const tasks: ScheduledTask[] = [];
  let makespan = 0;
  for (const sourceTask of resolved.source.tasks) {
    if (sourceTask.uniqueId === null) continue;
    if (!sourceTask.start || !sourceTask.finish) continue;
    const cal = calendarFor(resolved, sourceTask.uniqueId);
    const startDay = dateToDay(cal, startOfLocalDay(sourceTask.start));
    const finishDay = dateToDay(cal, endOfLocalDayExclusive(sourceTask.finish));
    tasks.push({
      uniqueId: sourceTask.uniqueId,
      startDay,
      finishDay,
      modeId: null,
    });
    if (finishDay > makespan) makespan = finishDay;
  }
  return {
    resolved,
    tasks,
    makespan,
    annotations: new Map(),
  };
}
