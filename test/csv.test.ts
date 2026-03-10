import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { CsvWriter } from "../src/csv/CsvWriter.ts";
import type { ProjectFile } from "../src/model/Project.ts";
import { Duration } from "../src/model/Duration.ts";
import { TimeUnit, ResourceType } from "../src/model/types.ts";

const FIXTURE_MPP_PATH = resolveFixturePath("./sample-schedule.mpp");
const FIXTURE_CSV_PATH = resolveFixturePath("./project_schedule.csv");

async function getMppReader() {
  return import("../src/mpp/MppReader.ts");
}

describe("CsvWriter", () => {
  test("produces CSV matching the fixture baseline for leaf tasks", async () => {
    const { MppReader } = await getMppReader();
    const project = await new MppReader().read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });

    const writer = new CsvWriter();
    const csv = writer.write(project);
    const baselineCsv = await Bun.file(FIXTURE_CSV_PATH).text();

    const csvRows = parseCsv(csv);
    const baselineRows = parseCsv(baselineCsv);

    expect(csvRows).toHaveLength(baselineRows.length);

    for (const [index, row] of csvRows.entries()) {
      const baseline = baselineRows[index]!;
      expect(row["ID"]).toBe(baseline["ID"]);
      expect(row["Task Name"]).toBe(baseline["Task Name"]);
      expect(row["WBS"]).toBe(baseline["WBS"]);
      expect(formatMinuteDate(row["Start"])).toBe(formatMinuteDate(baseline["Start"]));
      expect(formatMinuteDate(row["Finish"])).toBe(formatMinuteDate(baseline["Finish"]));
      expect(row["Duration"]).toBe(baseline["Duration"]);
      expect(row["Critical"]).toBe(baseline["Critical"]);
      expect(row["Milestone"]).toBe(baseline["Milestone"]);
    }
  });

  test("includes summary tasks when option is set", async () => {
    const { MppReader } = await getMppReader();
    const project = await new MppReader().read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });

    const leafCsv = new CsvWriter().write(project);
    const allCsv = new CsvWriter().write(project, { includeSummaryTasks: true });

    const leafRows = parseCsv(leafCsv);
    const allRows = parseCsv(allCsv);

    expect(allRows.length).toBeGreaterThan(leafRows.length);
  });

  test("excludes Resources column when option is set", () => {
    const project = makeMinimalProject();
    const csv = new CsvWriter().write(project, { includeResources: false });
    const header = csv.split("\n")[0]!;

    expect(header).not.toContain("Resources");
    expect(header).toContain("Milestone");
  });

  test("escapes fields containing commas, quotes, and newlines", () => {
    const project = makeMinimalProject();
    project.tasks[0]!.name = 'Task with "quotes" and, commas';

    const csv = new CsvWriter().write(project);
    expect(csv).toContain('"Task with ""quotes"" and, commas"');
  });

  test("resolves resource names from assignments", () => {
    const project = makeMinimalProject();
    project.resources = [
      {
        id: 1,
        uniqueId: 100,
        name: "Alice",
        type: ResourceType.Work,
        email: null,
        group: null,
        maxUnits: null,
        cost: null,
        work: null,
        resourcePool: null,
      },
      {
        id: 2,
        uniqueId: 200,
        name: "Bob",
        type: ResourceType.Work,
        email: null,
        group: null,
        maxUnits: null,
        cost: null,
        work: null,
        resourcePool: null,
      },
    ];
    project.assignments = [
      {
        taskUniqueId: 1,
        resourceUniqueId: 100,
        work: null,
        units: null,
        start: null,
        finish: null,
        actualWork: null,
        remainingWork: null,
      },
      {
        taskUniqueId: 1,
        resourceUniqueId: 200,
        work: null,
        units: null,
        start: null,
        finish: null,
        actualWork: null,
        remainingWork: null,
      },
    ];

    const csv = new CsvWriter().write(project);
    const rows = parseCsv(csv);
    expect(rows[0]!["Resources"]).toContain("Alice");
    expect(rows[0]!["Resources"]).toContain("Bob");
  });
});

function makeMinimalProject(): ProjectFile {
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

function formatMinuteDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 16);
}

function parseCsv(text: string): Array<Record<string, string>> {
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

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}
