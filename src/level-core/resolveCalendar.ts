// Project ──resolveCalendar──> ResolvedProject.
// Pure: in goes the user-facing `ProjectFile` with Date objects, out comes
// the day-indexed working value the rest of the pipeline operates on.

import type { Calendar } from "../model/Calendar.ts";
import type { Duration } from "../model/Duration.ts";
import { TimeUnit } from "../model/types.ts";
import type { ProjectFile, ProjectProperties } from "../schema/project.ts";
import type { Task } from "../schema/task.ts";

import {
  addCalendarDays,
  buildWorkingCalendar,
  endOfLocalDayExclusive,
  startOfLocalDay,
} from "./calendarDays.ts";
import type {
  PrecedenceEdge,
  ResolveOptions,
  ResolvedAssignment,
  ResolvedProject,
  ResolvedResource,
  ResolvedTask,
  WorkingCalendar,
} from "./types.ts";

const HORIZON_BUFFER_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const TEN_YEARS_DAYS = 365 * 10;
const SYNTHETIC_CAL_ID = -1;

function syntheticMonFriCalendar(): Calendar {
  return {
    uniqueId: SYNTHETIC_CAL_ID,
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

/** opts.epoch ?? properties.statusDate ?? min(task.start). Throws if none. */
function pickEpoch(project: ProjectFile, opts: ResolveOptions): Date {
  if (opts.epoch) return startOfLocalDay(opts.epoch);
  if (project.properties.statusDate) return startOfLocalDay(project.properties.statusDate);
  let earliest: Date | null = project.properties.startDate
    ? startOfLocalDay(project.properties.startDate)
    : null;
  for (const t of project.tasks) {
    if (t.start) {
      const s = startOfLocalDay(t.start);
      if (!earliest || s.getTime() < earliest.getTime()) earliest = s;
    }
  }
  if (!earliest) {
    throw new Error(
      "resolveCalendar: cannot pick epoch — no opts.epoch, statusDate, startDate, or task starts available",
    );
  }
  return earliest;
}

function pickHorizon(project: ProjectFile, epoch: Date, opts: ResolveOptions): number {
  if (opts.horizonDays !== undefined) {
    if (opts.horizonDays < 0) {
      throw new Error(`resolveCalendar: horizonDays must be >= 0, got ${String(opts.horizonDays)}`);
    }
    return opts.horizonDays;
  }
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
  const span = Math.max(0, Math.round((latest.getTime() - epoch.getTime()) / MS_PER_DAY));
  const scaled = Math.ceil(span * 1.25) + HORIZON_BUFFER_DAYS;
  return Math.min(TEN_YEARS_DAYS, scaled);
}

// Working-days-per-week derived from properties so non-Mon–Fri calendars
// are handled; the `5` below is only a degenerate fallback.
function workingDaysPerWeek(properties: ProjectProperties): number {
  const wpd = properties.minutesPerDay;
  const wpw = properties.minutesPerWeek;
  if (wpd <= 0 || wpw <= 0) return 5;
  return wpw / wpd;
}

// Lag → working days. MSPDI doesn't distinguish elapsed vs. working lag, so we
// pick the working-day interpretation (matches MS Project default when no
// `e`-prefix is present). Elapsed-lag support is a future addition.
function lagToWorkingDays(lag: Duration | null, properties: ProjectProperties): number {
  if (!lag) return 0;
  const minutesPerDay = properties.minutesPerDay;
  const wpw = workingDaysPerWeek(properties);
  const dpm = properties.daysPerMonth;
  switch (lag.unit) {
    case TimeUnit.Days:
      return Math.round(lag.value);
    case TimeUnit.Weeks:
      return Math.round(lag.value * wpw);
    case TimeUnit.Hours:
      return Math.round((lag.value * 60) / minutesPerDay);
    case TimeUnit.Minutes:
      return Math.round(lag.value / minutesPerDay);
    case TimeUnit.Months:
      return Math.round(lag.value * dpm);
    case TimeUnit.Percent:
      return 0;
  }
}

function durationToWorkingDays(
  dur: Duration | null,
  cal: WorkingCalendar,
  startDay: number,
  properties: ProjectProperties,
): number {
  if (!dur) return 0;
  const minutesPerDay = properties.minutesPerDay;
  const wpw = workingDaysPerWeek(properties);
  const dpm = properties.daysPerMonth;
  switch (dur.unit) {
    case TimeUnit.Days:
      return Math.max(0, Math.round(dur.value));
    case TimeUnit.Weeks:
      return Math.max(0, Math.round(dur.value * wpw));
    case TimeUnit.Hours:
      return Math.max(0, Math.round((dur.value * 60) / minutesPerDay));
    case TimeUnit.Minutes:
      return Math.max(0, Math.round(dur.value / minutesPerDay));
    case TimeUnit.Months:
      return Math.max(0, Math.round(dur.value * dpm));
    case TimeUnit.Percent:
      // Without a known reference, treat as zero. The pipeline can add a CPM
      // stage later if percent durations need to be resolved.
      void cal;
      void startDay;
      return 0;
  }
}

function calendarDayOffset(d: Date, epoch: Date): number {
  const dStart = startOfLocalDay(d).getTime();
  const eStart = epoch.getTime();
  return Math.round((dStart - eStart) / MS_PER_DAY);
}

function countWorkingDaysInRange(cal: WorkingCalendar, fromDay: number, toDay: number): number {
  const lo = Math.max(0, fromDay);
  const hi = Math.min(cal.horizonDays, toDay);
  if (hi <= lo) return 0;
  return cal.cumWorking[hi]! - cal.cumWorking[lo]!;
}

function resolveTask(
  task: Task,
  epoch: Date,
  cal: WorkingCalendar,
  properties: ProjectProperties,
): ResolvedTask {
  if (task.uniqueId === null) {
    throw new Error("resolveCalendar: task missing uniqueId");
  }
  if (!task.start || !task.finish) {
    throw new Error(`resolveCalendar: task ${String(task.uniqueId)} missing start or finish`);
  }
  const startDay = calendarDayOffset(task.start, epoch);
  const finishDay = calendarDayOffset(endOfLocalDayExclusive(task.finish), epoch);
  const durationDays =
    task.duration !== null
      ? durationToWorkingDays(task.duration, cal, startDay, properties)
      : countWorkingDaysInRange(cal, startDay, finishDay);
  return {
    uniqueId: task.uniqueId,
    name: task.name,
    durationDays,
    outlineLevel: task.outlineLevel,
    summary: task.summary ?? false,
    milestone: task.milestone ?? false,
    // Per-task calendar override would land here once the schema carries it.
    calendarUniqueId: null,
  };
}

function resolveEdges(tasks: ReadonlyArray<Task>, properties: ProjectProperties): PrecedenceEdge[] {
  const edges: PrecedenceEdge[] = [];
  for (const t of tasks) {
    if (t.uniqueId === null) continue;
    for (const r of t.predecessors) {
      if (r.predecessorUniqueId === null) continue;
      edges.push({
        predecessorUniqueId: r.predecessorUniqueId,
        successorUniqueId: t.uniqueId,
        type: r.type,
        lagDays: lagToWorkingDays(r.lag, properties),
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

// capacityPerDay = (resource.maxUnits ?? 1) * (minutesPerDay / 60).
function resolveResources(project: ProjectFile): ResolvedResource[] {
  const minutesPerDay = project.properties.minutesPerDay;
  const out: ResolvedResource[] = [];
  for (const r of project.resources) {
    if (r.uniqueId === null) continue;
    const maxUnits = r.maxUnits ?? 1;
    out.push({
      uniqueId: r.uniqueId,
      capacityPerDay: maxUnits * (minutesPerDay / 60),
      // Per-resource calendar override would land here once the schema carries it.
      calendarUniqueId: null,
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

/** Build a WorkingCalendar per distinct calendarUniqueId referenced by
 *  the project, plus any synthetic fallback. */
function buildCalendarMap(
  project: ProjectFile,
  defaultCalendar: Calendar,
  defaultCalendarUniqueId: number | null,
  epoch: Date,
  horizonDays: number,
): Map<number, WorkingCalendar> {
  const map = new Map<number, WorkingCalendar>();
  // Always include the default.
  map.set(
    defaultCalendarUniqueId ?? SYNTHETIC_CAL_ID,
    buildWorkingCalendar(defaultCalendar, defaultCalendarUniqueId, epoch, horizonDays),
  );
  // Any other named calendar with a uniqueId.
  for (const c of project.calendars) {
    if (c.uniqueId === null) continue;
    if (map.has(c.uniqueId)) continue;
    map.set(c.uniqueId, buildWorkingCalendar(c, c.uniqueId, epoch, horizonDays));
  }
  return map;
}

function pickDefaultCalendar(project: ProjectFile): {
  calendar: Calendar;
  uniqueId: number | null;
} {
  const id = project.properties.defaultCalendarUniqueId;
  if (id !== null) {
    const found = project.calendars.find((c) => c.uniqueId === id);
    if (found) return { calendar: found, uniqueId: found.uniqueId };
  }
  const first = project.calendars[0];
  if (first) return { calendar: first, uniqueId: first.uniqueId };
  return { calendar: syntheticMonFriCalendar(), uniqueId: null };
}

export function resolveCalendar(project: ProjectFile, opts: ResolveOptions = {}): ResolvedProject {
  validateTasks(project);
  const epoch = pickEpoch(project, opts);
  const horizonDays = pickHorizon(project, epoch, opts);
  const { calendar: defaultCalendar, uniqueId: defaultCalendarUniqueId } =
    pickDefaultCalendar(project);
  const calendars = buildCalendarMap(
    project,
    defaultCalendar,
    defaultCalendarUniqueId,
    epoch,
    horizonDays,
  );
  // The default calendar drives task/edge resolution. Per-task overrides
  // would consult `calendars.get(task.calendarUniqueId)` here once the
  // schema carries that field.
  const defaultId = defaultCalendarUniqueId ?? SYNTHETIC_CAL_ID;
  const defaultWorking = calendars.get(defaultId)!;
  const tasks = project.tasks.map((t) => resolveTask(t, epoch, defaultWorking, project.properties));
  const precedences = resolveEdges(project.tasks, project.properties);
  const assignments = resolveAssignments(project);
  const resources = resolveResources(project);
  return {
    source: project,
    defaultCalendarUniqueId: defaultCalendarUniqueId,
    calendars,
    tasks,
    resources,
    assignments,
    precedences,
  };
}

// Unused-but-exported epoch arithmetic kept for symmetry with calendarDays —
// resolveCalendar uses these via calendarDays helpers, but downstream stages
// often need the offset too.
export { addCalendarDays, calendarDayOffset };
