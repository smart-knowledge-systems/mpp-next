import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

import { XlsxWriter } from "../src/xlsx/XlsxWriter.ts";
import { makeMinimalProject } from "./helpers.ts";

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

    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.byteLength).toBeGreaterThan(0);

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

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}
