import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { ProjectFile } from "../model/Project.ts";
import type { Duration } from "../model/Duration.ts";
import { TimeUnit } from "../model/types.ts";

export interface XlsxWriterOptions {
  /** Worksheet name. Default: "Schedule". */
  sheetName?: string;
}

export interface GanttBar {
  name: string;
  /** ISO date string YYYY-MM-DD. */
  start: string;
  /** ISO date string YYYY-MM-DD. */
  finish: string;
}

export interface GanttPhase {
  label: string;
  items: GanttBar[];
}

export interface GanttSpec {
  phases: GanttPhase[];
  /** Chart title. Default: "Gantt". */
  title?: string;
  /** Hex colors (no #) cycled per phase. Default: ["4472C4", "ED7D31"] (blue, orange). */
  phaseColors?: string[];
}

const DEFAULT_PHASE_COLORS = ["4472C4", "ED7D31"];

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

function ymdToSerial(ymd: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid YYYY-MM-DD date: ${ymd}`);
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  const epoch = Date.UTC(1899, 11, 30);
  const utc = Date.UTC(y, mo - 1, d);
  return (utc - epoch) / 86400000;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function durationUnitLabel(dur: Duration): string {
  switch (dur.unit) {
    case TimeUnit.Minutes:
      return '" min"';
    case TimeUnit.Hours:
      return '" hrs"';
    case TimeUnit.Days:
      return '" days"';
    case TimeUnit.Weeks:
      return '" wks"';
    case TimeUnit.Months:
      return '" mos"';
    case TimeUnit.Percent:
      return '"%"';
    default:
      return "";
  }
}

export class XlsxWriter {
  async write(project: ProjectFile, options?: XlsxWriterOptions): Promise<Uint8Array> {
    const workbook = this.buildWorkbook(project, options);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Like {@link write}, but also adds a hidden `_Gantt Data` sheet and a
   * `Gantt` sheet hosting a stacked horizontal bar chart. Series 1 is the
   * transparent offset; series 2 is the visible duration, colored per phase.
   */
  async writeWithGantt(
    project: ProjectFile,
    gantt: GanttSpec,
    options?: XlsxWriterOptions,
  ): Promise<Uint8Array> {
    const flat: Array<{ phaseIdx: number; bar: GanttBar }> = [];
    for (let pi = 0; pi < gantt.phases.length; pi += 1) {
      for (const bar of gantt.phases[pi]!.items) {
        flat.push({ phaseIdx: pi, bar });
      }
    }

    if (flat.length === 0) {
      return this.write(project, options);
    }

    flat.sort((a, b) => {
      const sa = ymdToSerial(a.bar.start);
      const sb = ymdToSerial(b.bar.start);
      if (sa !== sb) return sa - sb;
      return a.bar.name.localeCompare(b.bar.name);
    });

    const colors = gantt.phaseColors ?? DEFAULT_PHASE_COLORS;
    const items = flat.map(({ phaseIdx, bar }) => {
      const offset = ymdToSerial(bar.start);
      const finish = ymdToSerial(bar.finish);
      return {
        label: `${gantt.phases[phaseIdx]!.label}: ${bar.name}`,
        offset,
        duration: Math.max(1, finish - offset),
        color: colors[phaseIdx % colors.length]!,
      };
    });

    const origin = Math.min(...items.map((i) => i.offset));
    const end = Math.max(...items.map((i) => i.offset + i.duration));

    const workbook = this.buildWorkbook(project, options);

    const dataSheetName = "_Gantt Data";
    const dataSheet = workbook.addWorksheet(dataSheetName, { state: "hidden" });
    dataSheet.addRow(["Item", "Offset", "Duration"]);
    for (const item of items) {
      dataSheet.addRow([item.label, item.offset, item.duration]);
    }

    workbook.addWorksheet("Gantt");

    const buffer = await workbook.xlsx.writeBuffer();
    const patched = await injectGanttChart(buffer, {
      items,
      origin,
      end,
      title: gantt.title ?? "Gantt",
      dataSheetName,
    });
    return new Uint8Array(patched);
  }

  private buildWorkbook(project: ProjectFile, options?: XlsxWriterOptions): ExcelJS.Workbook {
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

      if (startSerial) {
        row.getCell("start").numFmt = dateFormat;
      }
      if (finishSerial) {
        row.getCell("finish").numFmt = dateFormat;
      }

      if (task.duration) {
        const label = durationUnitLabel(task.duration);
        row.getCell("duration").numFmt = `#,##0.##${label}`;
      }

      const outlineLevel = task.outlineLevel ?? 0;
      if (outlineLevel > 0) {
        row.getCell("name").alignment = { indent: (outlineLevel - 1) * 2 };
      }

      if (task.summary) {
        row.font = { bold: true };
      }

      // Excel caps the outline level at 7.
      if (outlineLevel > 0) {
        row.outlineLevel = Math.min(outlineLevel, 7);
      }
    }

    sheet.properties.outlineLevelRow = 4;

    return workbook;
  }
}

interface GanttItem {
  label: string;
  offset: number;
  duration: number;
  color: string;
}

interface InjectArgs {
  items: GanttItem[];
  origin: number;
  end: number;
  title: string;
  dataSheetName: string;
}

async function injectGanttChart(
  buffer: ArrayBuffer | Uint8Array,
  { items, origin, end, title, dataSheetName }: InjectArgs,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);

  // The Gantt sheet is the 3rd sheet (Schedule, _Gantt Data, Gantt) and gets
  // written as sheet3.xml by ExcelJS in insertion order.
  const ganttSheetPath = "xl/worksheets/sheet3.xml";
  const ganttRelsPath = "xl/worksheets/_rels/sheet3.xml.rels";
  const drawingPath = "xl/drawings/drawing1.xml";
  const drawingRelsPath = "xl/drawings/_rels/drawing1.xml.rels";
  const chartPath = "xl/charts/chart1.xml";
  const contentTypesPath = "[Content_Types].xml";

  zip.file(chartPath, buildChartXml({ items, origin, end, title, dataSheetName }));
  zip.file(drawingPath, buildDrawingXml(items.length));
  zip.file(drawingRelsPath, buildDrawingRelsXml());
  zip.file(ganttRelsPath, buildSheetRelsXml());

  const sheetXml = await zip.file(ganttSheetPath)!.async("string");
  zip.file(ganttSheetPath, sheetXml.replace("</worksheet>", '<drawing r:id="rId1"/></worksheet>'));

  const ctXml = await zip.file(contentTypesPath)!.async("string");
  const ctPatched = ctXml.replace(
    "</Types>",
    '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      "</Types>",
  );
  zip.file(contentTypesPath, ctPatched);

  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

function buildChartXml({ items, origin, end, title, dataSheetName }: InjectArgs): string {
  const n = items.length;
  const lastRow = n + 1;
  const sheetRef = `'${dataSheetName.replace(/'/g, "''")}'`;

  const catCache = items
    .map((it, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(it.label)}</c:v></c:pt>`)
    .join("");
  const offsetCache = items
    .map((it, i) => `<c:pt idx="${i}"><c:v>${it.offset}</c:v></c:pt>`)
    .join("");
  const durCache = items
    .map((it, i) => `<c:pt idx="${i}"><c:v>${it.duration}</c:v></c:pt>`)
    .join("");
  const dPts = items
    .map(
      (it, i) =>
        `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>` +
        `<c:spPr><a:solidFill><a:srgbClr val="${it.color}"/></a:solidFill>` +
        `<a:ln><a:solidFill><a:srgbClr val="${it.color}"/></a:solidFill></a:ln></c:spPr></c:dPt>`,
    )
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<c:chart>" +
    "<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>" +
    `<a:p><a:r><a:t>${xmlEscape(title)}</a:t></a:r></a:p>` +
    '</c:rich></c:tx><c:overlay val="0"/></c:title>' +
    '<c:autoTitleDeleted val="0"/>' +
    "<c:plotArea><c:layout/>" +
    "<c:barChart>" +
    '<c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>' +
    // Series 0: invisible offset
    "<c:ser>" +
    '<c:idx val="0"/><c:order val="0"/>' +
    `<c:tx><c:strRef><c:f>${sheetRef}!$B$1</c:f>` +
    '<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Offset</c:v></c:pt></c:strCache>' +
    "</c:strRef></c:tx>" +
    "<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>" +
    '<c:invertIfNegative val="0"/>' +
    `<c:cat><c:strRef><c:f>${sheetRef}!$A$2:$A$${lastRow}</c:f>` +
    `<c:strCache><c:ptCount val="${n}"/>${catCache}</c:strCache></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${sheetRef}!$B$2:$B$${lastRow}</c:f>` +
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${offsetCache}</c:numCache>` +
    "</c:numRef></c:val>" +
    "</c:ser>" +
    // Series 1: duration, per-point colors
    "<c:ser>" +
    '<c:idx val="1"/><c:order val="1"/>' +
    `<c:tx><c:strRef><c:f>${sheetRef}!$C$1</c:f>` +
    '<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Duration</c:v></c:pt></c:strCache>' +
    "</c:strRef></c:tx>" +
    '<c:invertIfNegative val="0"/>' +
    dPts +
    `<c:cat><c:strRef><c:f>${sheetRef}!$A$2:$A$${lastRow}</c:f>` +
    `<c:strCache><c:ptCount val="${n}"/>${catCache}</c:strCache></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${sheetRef}!$C$2:$C$${lastRow}</c:f>` +
    `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${durCache}</c:numCache>` +
    "</c:numRef></c:val>" +
    "</c:ser>" +
    '<c:overlap val="100"/>' +
    '<c:axId val="111111111"/><c:axId val="222222222"/>' +
    "</c:barChart>" +
    // Category axis (visually the vertical axis on a horizontal bar chart)
    "<c:catAx>" +
    '<c:axId val="111111111"/>' +
    '<c:scaling><c:orientation val="maxMin"/></c:scaling>' +
    '<c:delete val="0"/><c:axPos val="l"/>' +
    '<c:crossAx val="222222222"/>' +
    "</c:catAx>" +
    // Value axis (the time axis along the bottom)
    "<c:valAx>" +
    '<c:axId val="222222222"/>' +
    `<c:scaling><c:orientation val="minMax"/><c:max val="${end}"/><c:min val="${origin}"/></c:scaling>` +
    '<c:delete val="0"/><c:axPos val="b"/>' +
    '<c:numFmt formatCode="mmm-yy" sourceLinked="0"/>' +
    '<c:majorTickMark val="out"/><c:minorTickMark val="none"/>' +
    '<c:crossAx val="111111111"/>' +
    '<c:majorUnit val="30"/>' +
    "</c:valAx>" +
    "</c:plotArea>" +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>' +
    "</c:chart></c:chartSpace>"
  );
}

function buildDrawingXml(n: number): string {
  // Anchor B2 to col 16, row ~ scaled by bar count so the chart is roughly proportional.
  const toRow = Math.max(20, n * 2 + 5);
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    "<xdr:twoCellAnchor>" +
    "<xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff>" +
    "<xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>" +
    `<xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff>` +
    `<xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    '<xdr:graphicFrame macro="">' +
    '<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/>' +
    "<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>" +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
    "<a:graphic>" +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
    '<c:chart r:id="rId1"/>' +
    "</a:graphicData></a:graphic>" +
    "</xdr:graphicFrame>" +
    "<xdr:clientData/>" +
    "</xdr:twoCellAnchor>" +
    "</xdr:wsDr>"
  );
}

function buildDrawingRelsXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1"' +
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"' +
    ' Target="../charts/chart1.xml"/>' +
    "</Relationships>"
  );
}

function buildSheetRelsXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1"' +
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"' +
    ' Target="../drawings/drawing1.xml"/>' +
    "</Relationships>"
  );
}
