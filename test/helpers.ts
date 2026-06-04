import { existsSync } from "node:fs";
import { Duration } from "../src/model/Duration.ts";
import { TimeUnit } from "../src/model/types.ts";
import type { ProjectFile } from "../src/model/Project.ts";

export function fixtureExists(path: string): boolean {
  return existsSync(path);
}

export function makeMinimalProject(): ProjectFile {
  return {
    properties: {
      title: "Test",
      author: null,
      startDate: null,
      finishDate: null,
      statusDate: null,
      defaultCalendarUniqueId: null,
      minutesPerDay: 480,
      minutesPerWeek: 2400,
      daysPerMonth: 20,
      saveVersion: null,
    },
    tasks: [
      {
        id: 1,
        uniqueId: 1,
        name: "Test Task",
        wbs: "1",
        outlineLevel: 1,
        start: new Date("2026-04-06T06:00:00"),
        finish: new Date("2026-04-06T14:00:00"),
        duration: Duration.from(8, TimeUnit.Hours),
        percentComplete: 0,
        summary: false,
        milestone: false,
        critical: false,
        notes: null,
        priority: null,
        cost: null,
        work: null,
        actualStart: null,
        actualFinish: null,
        baselineStart: null,
        baselineFinish: null,
        baselineDuration: null,
        actualWork: null,
        constraintType: null,
        freeSlack: null,
        totalSlack: null,
        earlyStart: null,
        earlyFinish: null,
        lateStart: null,
        lateFinish: null,
        levelingDelay: null,
        deadline: null,
        splits: null,
        predecessors: [],
      },
    ],
    resources: [],
    assignments: [],
    calendars: [],
  };
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += character;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((values) =>
    Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""])),
  );
}
