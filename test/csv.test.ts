import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { CsvWriter } from "../src/csv/CsvWriter.ts";
import { ResourceType } from "../src/model/types.ts";
import { makeMinimalProject, parseCsv, fixtureExists } from "./helpers.ts";

const FIXTURE_MPP_PATH = resolveFixturePath("./sample-schedule.mpp");
const FIXTURE_CSV_PATH = resolveFixturePath("./project_schedule.csv");
const HAS_MPP_FIXTURE = fixtureExists(FIXTURE_MPP_PATH);

async function getMppReader() {
  return import("../src/mpp/MppReader.ts");
}

describe("CsvWriter", () => {
  test.skipIf(!HAS_MPP_FIXTURE)(
    "produces CSV matching the fixture baseline for leaf tasks",
    async () => {
      const { MppReader } = await getMppReader();
      const data = await Bun.file(FIXTURE_MPP_PATH).arrayBuffer();
      const project = new MppReader().read(data);

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
    },
  );

  test.skipIf(!HAS_MPP_FIXTURE)("includes summary tasks when option is set", async () => {
    const { MppReader } = await getMppReader();
    const data = await Bun.file(FIXTURE_MPP_PATH).arrayBuffer();
    const project = new MppReader().read(data);

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

  test("prefixes injection characters with apostrophe", () => {
    const project = makeMinimalProject();

    const injectionInputs = ["=SUM(A1)", "+1", "-1", "@SUM(A1:A10)"];

    for (const input of injectionInputs) {
      project.tasks[0]!.name = input;
      const csv = new CsvWriter().write(project);
      const dataLine = csv.split("\n")[1]!;
      // Apostrophe prefix should appear; original value must not appear without it
      expect(dataLine).toContain("'" + input);
    }
  });

  test("applies both injection prefix and quote escaping together", () => {
    const project = makeMinimalProject();
    project.tasks[0]!.name = '=cmd,with "quotes"';

    const csv = new CsvWriter().write(project);
    // Should get apostrophe prefix AND quote wrapping: "'=cmd,with ""quotes"""
    expect(csv).toContain('"\'=cmd,with ""quotes"""');
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

function formatMinuteDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 16);
}

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}
