// D3: bridge for the no-search-yet case. Reads pre-existing dates from
// `resolved.source` into a Schedule shape so round-trip identity holds for
// projects that already have task dates pinned, and so partial pipelines
// can hand a Schedule to materialize() without going through Search.

import {
  dateToDay,
  endOfLocalDayExclusive,
  resolveWorkingCalendar,
  startOfLocalDay,
} from "./calendarDays.ts";
import type { ResolvedProject, Schedule, ScheduledTask } from "./types.ts";

export function currentSchedule(resolved: ResolvedProject): Schedule {
  const tasks: ScheduledTask[] = [];
  let makespan = 0;
  const taskById = new Map(resolved.tasks.map((t) => [t.uniqueId, t]));
  for (const sourceTask of resolved.source.tasks) {
    if (sourceTask.uniqueId === null) continue;
    if (!sourceTask.start || !sourceTask.finish) continue;
    const cal = resolveWorkingCalendar(
      resolved,
      taskById.get(sourceTask.uniqueId)?.calendarUniqueId ?? null,
    );
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
