import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";

import { XlsxWriter } from "../src/xlsx/XlsxWriter.ts";
import { makeMinimalProject, fixtureExists } from "./helpers.ts";

const FIXTURE_MPP_PATH = resolveFixturePath("./sample-schedule.mpp");
const HAS_MPP_FIXTURE = fixtureExists(FIXTURE_MPP_PATH);

async function getMppReader() {
  return import("../src/mpp/MppReader.ts");
}

describe("XlsxWriter", () => {
  test.skipIf(!HAS_MPP_FIXTURE)("produces a valid XLSX buffer from the MPP fixture", async () => {
    const { MppReader } = await getMppReader();
    const data = await Bun.file(FIXTURE_MPP_PATH).arrayBuffer();
    const project = new MppReader().read(data);

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

  test("writeWithGantt adds hidden data sheet, Gantt sheet, and chart XML", async () => {
    const project = makeMinimalProject();
    const buffer = await new XlsxWriter().writeWithGantt(project, {
      title: "OHT Installation",
      phases: [
        {
          label: "Phase 1",
          bays: [
            { name: "MB204", start: "2027-09-01", finish: "2027-11-15" },
            { name: "MB205", start: "2027-10-01", finish: "2027-12-15" },
          ],
        },
        {
          label: "Phase 2",
          bays: [{ name: "MB210", start: "2028-01-10", finish: "2028-02-28" }],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.buffer.slice(0) as ArrayBuffer);

    const dataSheet = workbook.getWorksheet("_Gantt Data");
    expect(dataSheet).toBeDefined();
    expect(dataSheet!.state).toBe("hidden");
    // header + 3 bays
    expect(dataSheet!.rowCount).toBe(4);
    // First data row should be the earliest start (2027-09-01) -> MB204
    const firstRow = dataSheet!.getRow(2);
    expect(firstRow.getCell(1).value).toBe("Phase 1: MB204");

    expect(workbook.getWorksheet("Gantt")).toBeDefined();

    const zip = await JSZip.loadAsync(buffer.buffer.slice(0) as ArrayBuffer);
    const chartFile = zip.file("xl/charts/chart1.xml");
    expect(chartFile).not.toBeNull();
    const chartXml = await chartFile!.async("string");
    expect(chartXml).toContain('<c:barDir val="bar"/>');
    expect(chartXml).toContain('<c:grouping val="stacked"/>');
    // Phase 1 color on the duration data points
    expect(chartXml).toContain('val="4472C4"');
    // Phase 2 color on the duration data points
    expect(chartXml).toContain('val="ED7D31"');

    const drawingFile = zip.file("xl/drawings/drawing1.xml");
    expect(drawingFile).not.toBeNull();

    const sheetRels = await zip.file("xl/worksheets/_rels/sheet3.xml.rels")!.async("string");
    expect(sheetRels).toContain("drawings/drawing1.xml");

    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain("/xl/charts/chart1.xml");
    expect(ct).toContain("/xl/drawings/drawing1.xml");
  });

  test("writeWithGantt with empty phases returns a plain xlsx", async () => {
    const project = makeMinimalProject();
    const buffer = await new XlsxWriter().writeWithGantt(project, { phases: [] });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.buffer.slice(0) as ArrayBuffer);

    expect(workbook.getWorksheet("Schedule")).toBeDefined();
    expect(workbook.getWorksheet("Gantt")).toBeUndefined();
    expect(workbook.getWorksheet("_Gantt Data")).toBeUndefined();
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
