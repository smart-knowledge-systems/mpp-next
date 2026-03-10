// Public API — convenience functions + re-exported types

import { MppReader } from "./mpp/MppReader.ts";
import { MspdiReader } from "./mspdi/MspdiReader.ts";
import { MspdiWriter } from "./mspdi/MspdiWriter.ts";
import type { ProjectFile } from "./model/Project.ts";

export async function readMpp(path: string): Promise<ProjectFile> {
  return new MppReader().read(path);
}

export function readMspdi(xml: string): ProjectFile {
  return new MspdiReader().read(xml);
}

export function writeMspdi(project: ProjectFile, options?: { saveVersion?: number }): string {
  return new MspdiWriter().write(project, options);
}

// Types
export type { ProjectFile } from "./model/Project.ts";
export type { ProjectProperties } from "./model/types.ts";
export type { Task } from "./model/Task.ts";
export type { Resource } from "./model/Resource.ts";
export type { Assignment } from "./model/Assignment.ts";
export type { Calendar } from "./model/Calendar.ts";
export type { Relation } from "./model/Relation.ts";

// Classes
export { Duration } from "./model/Duration.ts";

// Enums
export { TimeUnit, RelationType, ResourceType, ConstraintType, Priority } from "./model/types.ts";

// Date utilities
export { parseProjectDate, formatProjectDate } from "./dateTime.ts";
