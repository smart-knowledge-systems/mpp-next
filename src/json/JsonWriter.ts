import type { ProjectFile } from "../model/Project.ts";
import { Duration } from "../model/Duration.ts";
import { formatProjectDate } from "../dateTime.ts";

export interface JsonWriterOptions {
  pretty?: boolean; // default true, indent with 2 spaces
}

export class JsonWriter {
  write(project: ProjectFile, options?: JsonWriterOptions): string {
    const pretty = options?.pretty !== false;
    const indent = pretty ? 2 : undefined;
    return JSON.stringify(project, replacer, indent);
  }
}

function replacer(this: unknown, key: string, value: unknown): unknown {
  if (value instanceof Duration) {
    return { duration: value.value, units: value.unit };
  }
  // JSON.stringify calls Date.toJSON() before the replacer, so we need to
  // check the raw value on the parent object instead of the pre-serialized string
  const rawValue =
    key && typeof this === "object" && this !== null
      ? (this as Record<string, unknown>)[key]
      : undefined;
  if (rawValue instanceof Date) {
    return formatProjectDate(rawValue);
  }
  return value;
}
