import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { MspdiReader } from "../src/mspdi/MspdiReader.ts";
import { MspdiWriter } from "../src/mspdi/MspdiWriter.ts";
import { formatProjectDate } from "../src/dateTime.ts";
import { TimeUnit } from "../src/model/types.ts";
import type { ProjectFile } from "../src/model/Project.ts";
async function getMppReader() {
  const mod = await import("../src/mpp/MppReader.ts");
  return mod;
}

const FIXTURE_JSON_PATH = resolveFixturePath("./project_data.json");
const FIXTURE_MPP_PATH = resolveFixturePath("./sample-schedule.mpp");
const FIXTURE_CSV_PATH = resolveFixturePath("./project_schedule.csv");

describe("fixture mapping", () => {
  test("extracts project data from the mpp binary matching the json baseline", async () => {
    const { MppReader } = await getMppReader();
    const project = await new MppReader().read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });
    const expected = JSON.parse(await Bun.file(FIXTURE_JSON_PATH).text()) as SerializedProject;

    expect(serializeProject(project)).toEqual(expected);
  });

  test("matches the exported CSV for leaf task schedule rows from the mpp binary", async () => {
    const { MppReader } = await getMppReader();
    const project = await new MppReader().read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });
    const leafTasks = project.tasks.filter((task) => task.summary === false && task.id !== null);
    const csvRows = parseCsv(await Bun.file(FIXTURE_CSV_PATH).text());

    expect(csvRows).toHaveLength(leafTasks.length);

    for (const [index, row] of csvRows.entries()) {
      const task = leafTasks[index];
      expect(task).toBeDefined();
      expect(String(task!.id)).toBe(row["ID"] ?? "");
      expect(task!.name ?? "").toBe(row["Task Name"] ?? "");
      expect(task!.wbs ?? "").toBe(row["WBS"] ?? "");
      expect(formatMinuteDate(task!.start) ?? "").toBe(row["Start"] ?? "");
      expect(formatMinuteDate(task!.finish) ?? "").toBe(row["Finish"] ?? "");
      expect(task!.duration?.toSimpleString() ?? "").toBe(row["Duration"] ?? "");
      expect(formatDecimal(task!.percentComplete)).toBe(row["% Complete"] ?? "");
      expect(task!.critical ? "Yes" : "No").toBe(row["Critical"] ?? "");
      expect(task!.milestone ? "Yes" : "No").toBe(row["Milestone"] ?? "");
    }
  });
});

describe("mspdi", () => {
  test("round-trips the fixture project through MSPDI XML", async () => {
    const { MppReader } = await getMppReader();
    const project = await new MppReader().read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });
    const xml = new MspdiWriter().write(project, { saveVersion: 14 });
    const roundTripped = new MspdiReader().read(xml);

    expect(xml).toContain("<Project");
    expect(xml).toContain("<Tasks>");
    expect(roundTripped.tasks).toHaveLength(project.tasks.length);
    expect(roundTripped.resources).toHaveLength(project.resources.length);
    expect(roundTripped.assignments).toHaveLength(project.assignments.length);
    expect(roundTripped.calendars).toHaveLength(project.calendars.length);
    expect(roundTripped.tasks[10]?.name).toBe(project.tasks[10]?.name);
    expect(formatMinuteDate(roundTripped.tasks[10]?.start ?? null)).toBe(
      formatMinuteDate(project.tasks[10]?.start ?? null),
    );
  });

  test("parses and writes working-time durations, lag, and units using MSPDI conventions", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>16</SaveVersion>
  <Title>Variant Test</Title>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <CalendarUID>1</CalendarUID>
  <Tasks>
    <Task>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Task 1</Name>
      <OutlineLevel>1</OutlineLevel>
      <Start>2026-04-06T06:00:00</Start>
      <Finish>2026-04-06T14:00:00</Finish>
      <Duration>PT8H0M0S</Duration>
      <Work>PT8H0M0S</Work>
    </Task>
    <Task>
      <UID>2</UID>
      <ID>2</ID>
      <Name>Task 2</Name>
      <OutlineLevel>1</OutlineLevel>
      <Start>2026-04-07T06:00:00</Start>
      <Finish>2026-04-07T14:00:00</Finish>
      <Duration>PT8H0M0S</Duration>
      <PredecessorLink>
        <PredecessorUID>1</PredecessorUID>
        <Type>0</Type>
        <LinkLag>4800</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>
    </Task>
  </Tasks>
  <Resources>
    <Resource>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Worker 1</Name>
      <Type>1</Type>
      <MaxUnits>1.5</MaxUnits>
    </Resource>
  </Resources>
  <Assignments>
    <Assignment>
      <TaskUID>1</TaskUID>
      <ResourceUID>1</ResourceUID>
      <Units>0.5</Units>
      <Work>PT4H0M0S</Work>
      <Start>2026-04-06T06:00:00</Start>
      <Finish>2026-04-06T10:00:00</Finish>
    </Assignment>
  </Assignments>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.properties.saveVersion).toBe(16);
    expect(project.properties.defaultCalendarUniqueId).toBe(1);
    expect(project.tasks[0]?.duration?.toSimpleString()).toBe("1.0d");
    expect(project.tasks[0]?.work?.toSimpleString()).toBe("1.0d");
    expect(project.tasks[1]?.predecessors[0]?.lag?.toSimpleString()).toBe("1.0d");
    expect(project.resources[0]?.maxUnits).toBe(150);
    expect(project.assignments[0]?.units).toBe(50);
    expect(project.assignments[0]?.work?.toSimpleString()).toBe("4.0h");

    const written = new MspdiWriter().write(project, { saveVersion: 16 });
    expect(written).toContain("<SaveVersion>16</SaveVersion>");
    expect(written).toContain("<Duration>PT8H0M0S</Duration>");
    expect(written).toContain("<LinkLag>4800</LinkLag>");
    expect(written).toContain("<LagFormat>7</LagFormat>");
    expect(written).toContain("<MaxUnits>1.5</MaxUnits>");
    expect(written).toContain("<Units>0.5</Units>");
  });
});

describe("mpp inspection", () => {
  test("inspects the sample MPP container and reads directly from the binary API", async () => {
    const { MppReader } = await getMppReader();
    const reader = new MppReader();
    const inspection = await reader.inspect(FIXTURE_MPP_PATH);
    const project = await reader.read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });

    expect(inspection.version).toBe(14);
    expect(inspection.rootPath).toBe("Root Entry/   114");
    expect(inspection.formatPropsPath).toBe("Root Entry/Props14");
    expect(inspection.props14).not.toBeNull();
    expect(inspection.taskTable.fixedDataSize).toBeGreaterThan(0);
    expect(inspection.taskTable.var2DataSize).toBeGreaterThan(0);
    expect(project.tasks).toHaveLength(70);
  });

  test("detects and reads equivalent modern variants when stream roots are renamed", async () => {
    const { MppReader, loadMppContainer } = await getMppReader();
    const container = await loadMppContainer(FIXTURE_MPP_PATH);
    const variantContainer = {
      streams: new Map(
        [...container.streams.entries()].map(([path, value]) => [
          path
            .replace("Root Entry/Props14", "Root Entry/Props16")
            .replace("Root Entry/   114/", "Root Entry/   116/"),
          value,
        ]),
      ),
    };

    const reader = new MppReader();
    const inspection = reader.inspectContainer(variantContainer);
    const project = reader.readContainer(variantContainer);

    expect(inspection.version).toBe(16);
    expect(inspection.rootPath).toBe("Root Entry/   116");
    expect(inspection.formatPropsPath).toBe("Root Entry/Props16");
    expect(project.properties.saveVersion).toBe(16);
    expect(project.tasks).toHaveLength(70);
    expect(project.tasks[1]?.name).toBe("2-3 Modification");
  });
});

function formatMinuteDate(value: Date | null): string | null {
  const formatted = formatProjectDate(value);
  return formatted ? formatted.slice(0, 16) : null;
}

function formatDecimal(value: number | null): string {
  return value === null ? "" : Number.isInteger(value) ? value.toFixed(1) : String(value);
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
  if (!header) {
    return [];
  }
  return body.map((values) =>
    Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""])),
  );
}

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function serializeProject(project: ProjectFile) {
  return {
    project: {
      title: project.properties.title,
      author: project.properties.author,
      start_date: formatMinuteDate(project.properties.startDate),
      finish_date: formatMinuteDate(project.properties.finishDate),
      status_date: formatMinuteDate(project.properties.statusDate),
    },
    tasks: project.tasks.map((task) => ({
      id: task.id,
      unique_id: task.uniqueId,
      name: task.name,
      wbs: task.wbs,
      outline_level: task.outlineLevel,
      start: formatMinuteDate(task.start),
      finish: formatMinuteDate(task.finish),
      duration: serializeDuration(task.duration),
      percent_complete: task.percentComplete === null ? null : formatDecimal(task.percentComplete),
      summary: task.summary,
      milestone: task.milestone,
      critical: task.critical,
      notes: task.notes,
      priority: task.priority === null ? null : `[Priority value=${task.priority}]`,
      actual_start: formatMinuteDate(task.actualStart),
      actual_finish: formatMinuteDate(task.actualFinish),
      baseline_start: formatMinuteDate(task.baselineStart),
      baseline_finish: formatMinuteDate(task.baselineFinish),
      baseline_duration: serializeDuration(task.baselineDuration),
      cost: task.cost === null ? null : formatDecimal(task.cost),
      work: serializeDuration(task.work),
      predecessors: task.predecessors.map((predecessor) => ({
        predecessor_unique_id: predecessor.predecessorUniqueId,
        type: predecessor.type,
        lag: serializeDuration(predecessor.lag),
      })),
    })),
    resources: project.resources.map((resource) => ({
      id: resource.id,
      unique_id: resource.uniqueId,
      name: resource.name,
      type: resource.type,
      email: resource.email,
      group: resource.group,
      max_units: resource.maxUnits === null ? null : formatDecimal(resource.maxUnits),
      cost: resource.cost === null ? null : formatDecimal(resource.cost),
    })),
    assignments: project.assignments.map((assignment) => ({
      task_unique_id: assignment.taskUniqueId,
      resource_unique_id: assignment.resourceUniqueId,
      work: serializeDuration(assignment.work),
      units: assignment.units === null ? null : formatDecimal(assignment.units),
      start: formatMinuteDate(assignment.start),
      finish: formatMinuteDate(assignment.finish),
    })),
    calendars: project.calendars.map((calendar) => ({
      unique_id: calendar.uniqueId,
      name: calendar.name,
    })),
  };
}

function serializeDuration(
  value: { value: number; unit: TimeUnit; toSimpleString(): string } | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  return value.toSimpleString();
}

type SerializedProject = ReturnType<typeof serializeProject>;
