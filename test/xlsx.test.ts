import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

import { XlsxWriter } from "../src/xlsx/XlsxWriter.ts";
import { Duration } from "../src/model/Duration.ts";
import { TimeUnit, ResourceType } from "../src/model/types.ts";
import type { ProjectFile } from "../src/model/Project.ts";

const FIXTURE_MPP_PATH = resolveFixturePath("./sample-schedule.mpp");

async function getMppReader() {
  return import("../src/mpp/MppReader.ts");
}

describe("XlsxWriter", () => {
  test("produces a valid XLSX buffer from the MPP fixture", async () => {
    const { MppReader } = await getMppReader();
    const project = await new MppReader().read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });

    const writer = new XlsxWriter();
    const buffer = await writer.write(project);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Parse the buffer back and verify structure
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Schedule");
    expect(sheet).toBeDefined();

    // Header row + task rows (tasks with non-null id)
    const tasksWithId = project.tasks.filter((t) => t.id !== null);
    expect(sheet!.rowCount).toBe(tasksWithId.length + 1); // +1 for header

    // Verify header
    const headerRow = sheet!.getRow(1);
    expect(headerRow.getCell(1).value).toBe("ID");
    expect(headerRow.getCell(2).value).toBe("Task Name");
    expect(headerRow.getCell(3).value).toBe("WBS");
    expect(headerRow.getCell(4).value).toBe("Start");
    expect(headerRow.getCell(5).value).toBe("Finish");
    expect(headerRow.getCell(6).value).toBe("Duration");

    // Verify first data row matches first task
    const firstTask = tasksWithId[0]!;
    const firstRow = sheet!.getRow(2);
    expect(firstRow.getCell(1).value).toBe(firstTask.id);
    expect(firstRow.getCell(2).value).toBe(firstTask.name);
  });

  test("applies bold formatting to summary tasks", async () => {
    const project = makeMinimalProject();
    project.tasks[0]!.summary = true;

    const buffer = await new XlsxWriter().write(project);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Schedule")!;
    const row = sheet.getRow(2);
    expect(row.font?.bold).toBe(true);
  });

  test("sets row outline levels from task outline levels", async () => {
    const project = makeMinimalProject();
    project.tasks[0]!.outlineLevel = 3;

    const buffer = await new XlsxWriter().write(project);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Schedule")!;
    const row = sheet.getRow(2);
    expect(row.outlineLevel).toBe(3);
  });

  test("uses custom sheet name from options", async () => {
    const project = makeMinimalProject();
    const buffer = await new XlsxWriter().write(project, { sheetName: "Tasks" });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.getWorksheet("Tasks")).toBeDefined();
    expect(workbook.getWorksheet("Schedule")).toBeUndefined();
  });

  test("formats dates as Excel serial numbers with date numFmt", async () => {
    const project = makeMinimalProject();
    const buffer = await new XlsxWriter().write(project);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Schedule")!;
    const row = sheet.getRow(2);
    const startCell = row.getCell(4); // column 4 = Start

    // ExcelJS round-trips serial numbers as Date objects
    expect(startCell.value).not.toBeNull();
    expect(startCell.numFmt).toBe("M/D/YYYY H:MM AM/PM");
  });

  test("styles the header row with blue background and white bold text", async () => {
    const project = makeMinimalProject();
    const buffer = await new XlsxWriter().write(project);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Schedule")!;
    const headerRow = sheet.getRow(1);

    expect(headerRow.font?.bold).toBe(true);
    expect(headerRow.font?.color?.argb).toBe("FFFFFFFF");
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

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}
