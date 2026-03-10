// Public API — convenience functions + re-exported types

import { MppReader } from "./mpp/MppReader.ts";
import { MspdiReader } from "./mspdi/MspdiReader.ts";
import { MspdiWriter } from "./mspdi/MspdiWriter.ts";
import { JsonReader } from "./json/JsonReader.ts";
import { JsonWriter } from "./json/JsonWriter.ts";
import { CsvWriter } from "./csv/CsvWriter.ts";
import type { CsvWriterOptions } from "./csv/CsvWriter.ts";
import { XlsxWriter } from "./xlsx/XlsxWriter.ts";
import type { XlsxWriterOptions } from "./xlsx/XlsxWriter.ts";
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

export function readJson(json: string): ProjectFile {
  return new JsonReader().read(json);
}

export function writeJson(project: ProjectFile, options?: { pretty?: boolean }): string {
  return new JsonWriter().write(project, options);
}

export function writeCsv(project: ProjectFile, options?: CsvWriterOptions): string {
  return new CsvWriter().write(project, options);
}

export async function writeXlsx(
  project: ProjectFile,
  options?: XlsxWriterOptions,
): Promise<Buffer> {
  return new XlsxWriter().write(project, options);
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
export { JsonReader } from "./json/JsonReader.ts";
export { JsonWriter } from "./json/JsonWriter.ts";
export type { JsonWriterOptions } from "./json/JsonWriter.ts";
export { CsvWriter } from "./csv/CsvWriter.ts";
export type { CsvWriterOptions } from "./csv/CsvWriter.ts";
export { XlsxWriter } from "./xlsx/XlsxWriter.ts";
export type { XlsxWriterOptions } from "./xlsx/XlsxWriter.ts";

// Enums
export { TimeUnit, RelationType, ResourceType, ConstraintType, Priority } from "./model/types.ts";

// Date utilities
export { parseProjectDate, formatProjectDate } from "./dateTime.ts";
