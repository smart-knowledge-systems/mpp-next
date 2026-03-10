import ExcelJS from "exceljs";
import type { ProjectFile } from "../model/Project.ts";
import type { Duration } from "../model/Duration.ts";

export interface XlsxWriterOptions {
  /** Worksheet name. Default: "Schedule". */
  sheetName?: string;
}

/**
 * Converts a Date to an Excel serial number (days since 1899-12-30),
 * avoiding timezone issues by working directly with date components.
 */
function dateToSerial(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-based
  const d = date.getDate();
  const h = date.getHours();
  const min = date.getMinutes();

  // Excel epoch: day 0 = 1899-12-30 (includes the intentional 1900 leap year bug)
  const epoch = Date.UTC(1899, 11, 30);
  const dateUtc = Date.UTC(y, m, d);
  const days = (dateUtc - epoch) / 86400000;
  const timeFraction = (h * 60 + min) / 1440;
  return days + timeFraction;
}

function durationUnitLabel(dur: Duration): string {
  switch (dur.unit) {
    case "minutes":
      return '" min"';
    case "hours":
      return '" hrs"';
    case "days":
      return '" days"';
    case "weeks":
      return '" wks"';
    case "months":
      return '" mos"';
    case "percent":
      return '"%"';
    default:
      return "";
  }
}

export class XlsxWriter {
  async write(project: ProjectFile, options?: XlsxWriterOptions): Promise<Uint8Array> {
    const sheetName = options?.sheetName ?? "Schedule";

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName, {
      properties: { outlineLevelRow: 4 },
    });

    sheet.columns = [
      { header: "ID", key: "id", width: 6 },
      { header: "Task Name", key: "name", width: 55 },
      { header: "WBS", key: "wbs", width: 10 },
      { header: "Start", key: "start", width: 18 },
      { header: "Finish", key: "finish", width: 18 },
      { header: "Duration", key: "duration", width: 14 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4472C4" },
    };
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

    const dateFormat = "M/D/YYYY H:MM AM/PM";

    for (const task of project.tasks) {
      if (task.id === null) continue;

      const startSerial = task.start ? dateToSerial(task.start) : null;
      const finishSerial = task.finish ? dateToSerial(task.finish) : null;

      const row = sheet.addRow({
        id: task.id,
        name: task.name,
        wbs: task.wbs,
        start: startSerial,
        finish: finishSerial,
        duration: task.duration?.value ?? null,
      });

      // Date formatting
      if (startSerial) {
        row.getCell("start").numFmt = dateFormat;
      }
      if (finishSerial) {
        row.getCell("finish").numFmt = dateFormat;
      }

      // Duration: custom format with unit suffix
      if (task.duration) {
        const label = durationUnitLabel(task.duration);
        row.getCell("duration").numFmt = `#,##0.##${label}`;
      }

      // Indent task name based on outline level
      const outlineLevel = task.outlineLevel ?? 0;
      if (outlineLevel > 0) {
        row.getCell("name").alignment = { indent: (outlineLevel - 1) * 2 };
      }

      // Summary rows get bold
      if (task.summary) {
        row.font = { bold: true };
      }

      // Set row outline level for collapsible groups (max 7 in Excel)
      if (outlineLevel > 0) {
        row.outlineLevel = Math.min(outlineLevel, 7);
      }
    }

    sheet.properties.outlineLevelRow = 4;

    return await workbook.xlsx.writeBuffer();
  }
}
