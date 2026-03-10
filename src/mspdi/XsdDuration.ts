import { Duration } from "../model/Duration.ts";
import { TimeUnit, type ProjectProperties } from "../model/types.ts";

interface DurationContext {
  minutesPerDay?: number | null;
  minutesPerWeek?: number | null;
  daysPerMonth?: number | null;
}

export function parseXsdDuration(
  raw: string | null | undefined,
  context?: DurationContext,
): Duration | null {
  if (!raw) {
    return null;
  }

  const text = raw.trim();
  const match =
    /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/iu.exec(
      text,
    );
  if (!match) {
    return null;
  }

  const weeks = Number(match[1] ?? 0);
  const days = Number(match[2] ?? 0);
  const hours = Number(match[3] ?? 0);
  const minutes = Number(match[4] ?? 0);
  const seconds = Number(match[5] ?? 0);
  if (weeks > 0) {
    return Duration.from(weeks, TimeUnit.Weeks);
  }
  if (days > 0 && hours === 0 && minutes === 0 && seconds === 0) {
    return Duration.from(days, TimeUnit.Days);
  }

  const totalMinutes = hours * 60 + minutes + seconds / 60 + toMinutes(days, TimeUnit.Days, context);
  return fromWorkingMinutes(totalMinutes, context);
}

export function formatXsdDuration(
  duration: Duration | null | undefined,
  context?: DurationContext,
): string | null {
  if (!duration) {
    return null;
  }

  const totalMinutes = toMinutes(duration.value, duration.unit, context);
  const totalSeconds = Math.round(totalMinutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `PT${hours}H${minutes}M${seconds}S`;
}

export function parseLinkLag(
  raw: string | null | undefined,
  lagFormat: string | null | undefined,
  context?: DurationContext,
): Duration | null {
  if (!raw) {
    return null;
  }

  const tenths = Number(raw);
  if (!Number.isFinite(tenths)) {
    return null;
  }

  const totalMinutes = tenths / 10;
  const unit = parseLagFormatUnit(lagFormat);
  const unitMinutes = toMinutes(1, unit, context);
  if (unitMinutes === 0) {
    return Duration.from(0, unit);
  }

  return Duration.from(totalMinutes / unitMinutes, unit);
}

export function formatLinkLag(
  lag: Duration | null | undefined,
  context?: DurationContext,
): { linkLag: string | null; lagFormat: string | null } {
  if (!lag) {
    return { linkLag: null, lagFormat: null };
  }

  return {
    linkLag: String(Math.round(toMinutes(lag.value, lag.unit, context) * 10)),
    lagFormat: formatLagFormat(lag.unit),
  };
}

export function durationContextFromProject(
  project: Pick<
    ProjectProperties,
    "minutesPerDay" | "minutesPerWeek" | "daysPerMonth"
  >,
): DurationContext {
  return {
    minutesPerDay: project.minutesPerDay,
    minutesPerWeek: project.minutesPerWeek,
    daysPerMonth: project.daysPerMonth,
  };
}

function fromWorkingMinutes(
  totalMinutes: number,
  context?: DurationContext,
): Duration {
  const minutesPerWeek = normalizeMinutesPerWeek(context);
  const minutesPerDay = normalizeMinutesPerDay(context);

  if (isWholeMultiple(totalMinutes, minutesPerWeek) && totalMinutes >= minutesPerWeek) {
    return Duration.from(totalMinutes / minutesPerWeek, TimeUnit.Weeks);
  }
  if (isWholeMultiple(totalMinutes, minutesPerDay) && totalMinutes >= minutesPerDay) {
    return Duration.from(totalMinutes / minutesPerDay, TimeUnit.Days);
  }
  if (isWholeMultiple(totalMinutes, 60) && totalMinutes >= 60) {
    return Duration.from(totalMinutes / 60, TimeUnit.Hours);
  }
  return Duration.from(totalMinutes, TimeUnit.Minutes);
}

function toMinutes(
  value: number,
  unit: TimeUnit,
  context?: DurationContext,
): number {
  switch (unit) {
    case TimeUnit.Weeks:
      return value * normalizeMinutesPerWeek(context);
    case TimeUnit.Days:
      return value * normalizeMinutesPerDay(context);
    case TimeUnit.Hours:
      return value * 60;
    case TimeUnit.Months:
      return value * normalizeDaysPerMonth(context) * normalizeMinutesPerDay(context);
    case TimeUnit.Percent:
      return 0;
    case TimeUnit.Minutes:
    default:
      return value;
  }
}

function normalizeMinutesPerDay(context?: DurationContext): number {
  return context?.minutesPerDay && context.minutesPerDay > 0
    ? context.minutesPerDay
    : 480;
}

function normalizeMinutesPerWeek(context?: DurationContext): number {
  return context?.minutesPerWeek && context.minutesPerWeek > 0
    ? context.minutesPerWeek
    : normalizeMinutesPerDay(context) * 5;
}

function normalizeDaysPerMonth(context?: DurationContext): number {
  return context?.daysPerMonth && context.daysPerMonth > 0
    ? context.daysPerMonth
    : 20;
}

function isWholeMultiple(value: number, base: number): boolean {
  if (base === 0) {
    return false;
  }
  return Math.abs(value / base - Math.round(value / base)) < 0.000001;
}

function parseLagFormatUnit(raw: string | null | undefined): TimeUnit {
  switch (raw) {
    case "3":
    case "4":
      return TimeUnit.Minutes;
    case "5":
    case "6":
      return TimeUnit.Hours;
    case "7":
    case "8":
      return TimeUnit.Days;
    case "9":
    case "10":
      return TimeUnit.Weeks;
    case "11":
    case "12":
      return TimeUnit.Months;
    case "19":
    case "20":
      return TimeUnit.Percent;
    default:
      return TimeUnit.Days;
  }
}

function formatLagFormat(unit: TimeUnit): string {
  switch (unit) {
    case TimeUnit.Minutes:
      return "3";
    case TimeUnit.Hours:
      return "5";
    case TimeUnit.Weeks:
      return "9";
    case TimeUnit.Months:
      return "11";
    case TimeUnit.Percent:
      return "19";
    case TimeUnit.Days:
    default:
      return "7";
  }
}
