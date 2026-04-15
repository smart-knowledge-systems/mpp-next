import { TimeUnit } from "./types.ts";

const SIMPLE_DURATION_RE = /^(-?\d+(?:\.\d+)?)([mhdw])$/i;

export class Duration {
  constructor(
    public readonly value: number,
    public readonly unit: TimeUnit,
  ) {}

  static from(value: number, unit: TimeUnit): Duration {
    return new Duration(value, unit);
  }

  static parseSimple(raw: string | null | undefined): Duration | null {
    if (!raw) {
      return null;
    }

    const match = SIMPLE_DURATION_RE.exec(raw.trim());
    if (!match) {
      return null;
    }

    const valuePart = match[1];
    const unitPart = match[2];
    if (!valuePart || !unitPart) {
      return null;
    }

    const value = Number(valuePart);
    const unit = unitPart.toLowerCase();
    switch (unit) {
      case "m":
        return new Duration(value, TimeUnit.Minutes);
      case "h":
        return new Duration(value, TimeUnit.Hours);
      case "d":
        return new Duration(value, TimeUnit.Days);
      case "w":
        return new Duration(value, TimeUnit.Weeks);
      default:
        return null;
    }
  }

  toIso8601(): string {
    switch (this.unit) {
      case TimeUnit.Weeks:
        return `P${String(this.value)}W`;
      case TimeUnit.Days:
        return `P${String(this.value)}D`;
      case TimeUnit.Hours:
        return `PT${String(this.value)}H0M0S`;
      case TimeUnit.Minutes:
        return `PT0H${String(this.value)}M0S`;
      case TimeUnit.Months:
        return `P${String(this.value)}M`;
      case TimeUnit.Percent:
        return `PT${String(this.value)}M0S`;
    }
  }

  toSimpleString(): string {
    const value = Number.isInteger(this.value) ? this.value.toFixed(1) : String(this.value);
    switch (this.unit) {
      case TimeUnit.Minutes:
        return `${value}m`;
      case TimeUnit.Hours:
        return `${value}h`;
      case TimeUnit.Days:
        return `${value}d`;
      case TimeUnit.Weeks:
        return `${value}w`;
      case TimeUnit.Months:
        return `${value}mo`;
      case TimeUnit.Percent:
        return `${value}%`;
    }
  }
}
