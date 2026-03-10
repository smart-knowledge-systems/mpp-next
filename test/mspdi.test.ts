import { describe, expect, test } from "bun:test";

import { MspdiReader } from "../src/mspdi/MspdiReader.ts";
import { MspdiWriter } from "../src/mspdi/MspdiWriter.ts";
import {
  parseXsdDuration,
  formatXsdDuration,
  parseLinkLag,
  formatLinkLag,
  durationContextFromProject,
} from "../src/mspdi/XsdDuration.ts";
import { Duration } from "../src/model/Duration.ts";
import { TimeUnit, RelationType, ResourceType } from "../src/model/types.ts";
import { createEmptyProject } from "../src/model/Project.ts";

// ---------------------------------------------------------------------------
// XsdDuration standalone tests
// ---------------------------------------------------------------------------

describe("XsdDuration", () => {
  const defaultContext = { minutesPerDay: 480, minutesPerWeek: 2400, daysPerMonth: 20 };

  describe("parseXsdDuration", () => {
    test("returns null for null/undefined/empty", () => {
      expect(parseXsdDuration(null)).toBeNull();
      expect(parseXsdDuration(undefined)).toBeNull();
      expect(parseXsdDuration("")).toBeNull();
    });

    test("returns null for invalid format", () => {
      expect(parseXsdDuration("not a duration")).toBeNull();
      expect(parseXsdDuration("12345")).toBeNull();
    });

    test("parses weeks", () => {
      const d = parseXsdDuration("P2W");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(2);
      expect(d!.unit).toBe(TimeUnit.Weeks);
    });

    test("parses pure days", () => {
      const d = parseXsdDuration("P5D");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(5);
      expect(d!.unit).toBe(TimeUnit.Days);
    });

    test("parses hours as days when it is a whole multiple of minutesPerDay", () => {
      // PT8H0M0S = 480 minutes = 1 day with default context
      const d = parseXsdDuration("PT8H0M0S", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(1);
      expect(d!.unit).toBe(TimeUnit.Days);
    });

    test("parses hours when not a day multiple", () => {
      // PT4H0M0S = 240 minutes = 4 hours
      const d = parseXsdDuration("PT4H0M0S", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(4);
      expect(d!.unit).toBe(TimeUnit.Hours);
    });

    test("parses minutes", () => {
      const d = parseXsdDuration("PT0H30M0S", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(30);
      expect(d!.unit).toBe(TimeUnit.Minutes);
    });

    test("parses weeks from hours when whole multiple of minutesPerWeek", () => {
      // PT40H0M0S = 2400 minutes = 1 week with default context
      const d = parseXsdDuration("PT40H0M0S", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(1);
      expect(d!.unit).toBe(TimeUnit.Weeks);
    });

    test("parses seconds", () => {
      // PT0H0M120S = 2 minutes
      const d = parseXsdDuration("PT0H0M120S", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(2);
      expect(d!.unit).toBe(TimeUnit.Minutes);
    });

    test("uses custom context", () => {
      // 600 min/day context: PT10H = 600 min = 1 day
      const d = parseXsdDuration("PT10H0M0S", { minutesPerDay: 600, minutesPerWeek: 3000, daysPerMonth: 20 });
      expect(d).not.toBeNull();
      expect(d!.value).toBe(1);
      expect(d!.unit).toBe(TimeUnit.Days);
    });
  });

  describe("formatXsdDuration", () => {
    test("returns null for null/undefined", () => {
      expect(formatXsdDuration(null)).toBeNull();
      expect(formatXsdDuration(undefined)).toBeNull();
    });

    test("formats days", () => {
      const d = Duration.from(1, TimeUnit.Days);
      expect(formatXsdDuration(d, defaultContext)).toBe("PT8H0M0S");
    });

    test("formats hours", () => {
      const d = Duration.from(4, TimeUnit.Hours);
      expect(formatXsdDuration(d, defaultContext)).toBe("PT4H0M0S");
    });

    test("formats minutes", () => {
      const d = Duration.from(30, TimeUnit.Minutes);
      expect(formatXsdDuration(d, defaultContext)).toBe("PT0H30M0S");
    });

    test("formats weeks", () => {
      const d = Duration.from(1, TimeUnit.Weeks);
      expect(formatXsdDuration(d, defaultContext)).toBe("PT40H0M0S");
    });
  });

  describe("parseLinkLag", () => {
    test("returns null for null/undefined/empty", () => {
      expect(parseLinkLag(null, null)).toBeNull();
      expect(parseLinkLag(undefined, undefined)).toBeNull();
      expect(parseLinkLag("", "7")).toBeNull();
    });

    test("returns null for non-numeric lag", () => {
      expect(parseLinkLag("abc", "7")).toBeNull();
    });

    test("parses day lag (format 7)", () => {
      // 4800 tenths = 480 minutes = 1 day
      const d = parseLinkLag("4800", "7", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(1);
      expect(d!.unit).toBe(TimeUnit.Days);
    });

    test("parses hour lag (format 5)", () => {
      // 600 tenths = 60 minutes = 1 hour
      const d = parseLinkLag("600", "5", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(1);
      expect(d!.unit).toBe(TimeUnit.Hours);
    });

    test("parses minute lag (format 3)", () => {
      // 300 tenths = 30 minutes
      const d = parseLinkLag("300", "3", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(30);
      expect(d!.unit).toBe(TimeUnit.Minutes);
    });

    test("parses week lag (format 9)", () => {
      // 24000 tenths = 2400 minutes = 1 week
      const d = parseLinkLag("24000", "9", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(1);
      expect(d!.unit).toBe(TimeUnit.Weeks);
    });

    test("parses percent lag (format 19)", () => {
      // Percent unit has 0 unitMinutes, so result is 0
      const d = parseLinkLag("500", "19", defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(0);
      expect(d!.unit).toBe(TimeUnit.Percent);
    });

    test("defaults to day format when lagFormat is undefined", () => {
      const d = parseLinkLag("4800", undefined, defaultContext);
      expect(d).not.toBeNull();
      expect(d!.value).toBe(1);
      expect(d!.unit).toBe(TimeUnit.Days);
    });
  });

  describe("formatLinkLag", () => {
    test("returns nulls for null/undefined", () => {
      expect(formatLinkLag(null)).toEqual({ linkLag: null, lagFormat: null });
      expect(formatLinkLag(undefined)).toEqual({ linkLag: null, lagFormat: null });
    });

    test("formats day lag", () => {
      const d = Duration.from(1, TimeUnit.Days);
      const result = formatLinkLag(d, defaultContext);
      expect(result.linkLag).toBe("4800");
      expect(result.lagFormat).toBe("7");
    });

    test("formats hour lag", () => {
      const d = Duration.from(2, TimeUnit.Hours);
      const result = formatLinkLag(d, defaultContext);
      expect(result.linkLag).toBe("1200");
      expect(result.lagFormat).toBe("5");
    });

    test("formats week lag", () => {
      const d = Duration.from(1, TimeUnit.Weeks);
      const result = formatLinkLag(d, defaultContext);
      expect(result.linkLag).toBe("24000");
      expect(result.lagFormat).toBe("9");
    });
  });

  describe("durationContextFromProject", () => {
    test("extracts correct fields from project properties", () => {
      const ctx = durationContextFromProject({
        minutesPerDay: 480,
        minutesPerWeek: 2400,
        daysPerMonth: 20,
      });
      expect(ctx.minutesPerDay).toBe(480);
      expect(ctx.minutesPerWeek).toBe(2400);
      expect(ctx.daysPerMonth).toBe(20);
    });
  });
});

// ---------------------------------------------------------------------------
// MspdiReader / MspdiWriter standalone tests
// ---------------------------------------------------------------------------

describe("MspdiReader", () => {
  test("throws when Project root element is missing", () => {
    const reader = new MspdiReader();
    expect(() => reader.read("<NotAProject></NotAProject>")).toThrow(
      "MSPDI XML is missing the Project root element",
    );
  });

  test("reads a minimal project", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Title>Test Project</Title>
  <Author>Tester</Author>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
</Project>`;

    const reader = new MspdiReader();
    const project = reader.read(xml);

    expect(project.properties.saveVersion).toBe(14);
    expect(project.properties.title).toBe("Test Project");
    expect(project.properties.author).toBe("Tester");
    expect(project.properties.minutesPerDay).toBe(480);
    expect(project.properties.minutesPerWeek).toBe(2400);
    expect(project.properties.daysPerMonth).toBe(20);
    expect(project.tasks).toHaveLength(0);
    expect(project.resources).toHaveLength(0);
    expect(project.assignments).toHaveLength(0);
    expect(project.calendars).toHaveLength(0);
  });

  test("uses defaults for missing minutesPerDay/minutesPerWeek/daysPerMonth", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Title>Minimal</Title>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.properties.minutesPerDay).toBe(480);
    expect(project.properties.minutesPerWeek).toBe(2400);
    expect(project.properties.daysPerMonth).toBe(20);
  });

  test("reads tasks with predecessors", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <Tasks>
    <Task>
      <UID>1</UID>
      <ID>1</ID>
      <Name>First</Name>
      <OutlineLevel>1</OutlineLevel>
    </Task>
    <Task>
      <UID>2</UID>
      <ID>2</ID>
      <Name>Second</Name>
      <OutlineLevel>1</OutlineLevel>
      <PredecessorLink>
        <PredecessorUID>1</PredecessorUID>
        <Type>0</Type>
        <LinkLag>0</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>
    </Task>
  </Tasks>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.tasks).toHaveLength(2);
    expect(project.tasks[0]?.name).toBe("First");
    expect(project.tasks[1]?.name).toBe("Second");
    expect(project.tasks[1]?.predecessors).toHaveLength(1);
    expect(project.tasks[1]?.predecessors[0]?.predecessorUniqueId).toBe(1);
    expect(project.tasks[1]?.predecessors[0]?.successorUniqueId).toBe(2);
    expect(project.tasks[1]?.predecessors[0]?.type).toBe(RelationType.FinishToStart);
  });

  test("reads resources with type parsing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Resources>
    <Resource>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Work Resource</Name>
      <Type>1</Type>
      <MaxUnits>1.0</MaxUnits>
    </Resource>
    <Resource>
      <UID>2</UID>
      <ID>2</ID>
      <Name>Material Resource</Name>
      <Type>0</Type>
    </Resource>
    <Resource>
      <UID>3</UID>
      <ID>3</ID>
      <Name>Cost Resource</Name>
      <Type>2</Type>
    </Resource>
  </Resources>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.resources).toHaveLength(3);
    expect(project.resources[0]?.type).toBe(ResourceType.Work);
    expect(project.resources[0]?.maxUnits).toBe(100);
    expect(project.resources[1]?.type).toBe(ResourceType.Material);
    expect(project.resources[2]?.type).toBe(ResourceType.Cost);
  });

  test("reads calendars with week days and exceptions", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <WeekDays>
        <WeekDay>
          <DayType>2</DayType>
          <DayWorking>1</DayWorking>
          <WorkingTimes>
            <WorkingTime>
              <FromTime>08:00:00</FromTime>
              <ToTime>12:00:00</ToTime>
            </WorkingTime>
            <WorkingTime>
              <FromTime>13:00:00</FromTime>
              <ToTime>17:00:00</ToTime>
            </WorkingTime>
          </WorkingTimes>
        </WeekDay>
        <WeekDay>
          <DayType>1</DayType>
          <DayWorking>0</DayWorking>
        </WeekDay>
      </WeekDays>
      <Exceptions>
        <Exception>
          <Name>Holiday</Name>
          <FromDate>2026-12-25T00:00:00</FromDate>
          <ToDate>2026-12-25T00:00:00</ToDate>
          <Working>0</Working>
        </Exception>
      </Exceptions>
    </Calendar>
  </Calendars>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.calendars).toHaveLength(1);
    expect(project.calendars[0]?.name).toBe("Standard");
    expect(project.calendars[0]?.weekDays).toHaveLength(2);
    expect(project.calendars[0]?.weekDays[0]?.dayType).toBe(2);
    expect(project.calendars[0]?.weekDays[0]?.working).toBe(true);
    expect(project.calendars[0]?.weekDays[0]?.workingTimes).toHaveLength(2);
    expect(project.calendars[0]?.weekDays[0]?.workingTimes[0]?.from).toBe("08:00:00");
    expect(project.calendars[0]?.weekDays[0]?.workingTimes[0]?.to).toBe("12:00:00");
    expect(project.calendars[0]?.weekDays[1]?.working).toBe(false);
    expect(project.calendars[0]?.exceptions).toHaveLength(1);
    expect(project.calendars[0]?.exceptions[0]?.name).toBe("Holiday");
    expect(project.calendars[0]?.exceptions[0]?.working).toBe(false);
  });

  test("reads assignments with units conversion", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Assignments>
    <Assignment>
      <TaskUID>1</TaskUID>
      <ResourceUID>1</ResourceUID>
      <Units>0.75</Units>
      <Work>PT4H0M0S</Work>
      <Start>2026-04-06T08:00:00</Start>
      <Finish>2026-04-06T12:00:00</Finish>
    </Assignment>
  </Assignments>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.assignments).toHaveLength(1);
    expect(project.assignments[0]?.taskUniqueId).toBe(1);
    expect(project.assignments[0]?.resourceUniqueId).toBe(1);
    expect(project.assignments[0]?.units).toBe(75);
    expect(project.assignments[0]?.work?.value).toBe(4);
    expect(project.assignments[0]?.work?.unit).toBe(TimeUnit.Hours);
  });

  test("handles single-element arrays (no array wrapping by parser)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Tasks>
    <Task>
      <UID>1</UID>
      <Name>Only Task</Name>
    </Task>
  </Tasks>
  <Resources>
    <Resource>
      <UID>1</UID>
      <Name>Only Resource</Name>
    </Resource>
  </Resources>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.tasks).toHaveLength(1);
    expect(project.resources).toHaveLength(1);
  });
});

describe("MspdiWriter", () => {
  test("writes a minimal project", () => {
    const project = createEmptyProject();
    project.properties.title = "Test";
    project.properties.saveVersion = 14;

    const writer = new MspdiWriter();
    const xml = writer.write(project);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
    expect(xml).toContain("<SaveVersion>14</SaveVersion>");
    expect(xml).toContain("<Title>Test</Title>");
    expect(xml).toContain("<Calendars>");
    expect(xml).toContain("<Tasks>");
    expect(xml).toContain("<Resources>");
    expect(xml).toContain("<Assignments>");
  });

  test("uses saveVersion from options", () => {
    const project = createEmptyProject();
    const xml = new MspdiWriter().write(project, { saveVersion: 16 });
    expect(xml).toContain("<SaveVersion>16</SaveVersion>");
  });

  test("defaults saveVersion to 14", () => {
    const project = createEmptyProject();
    const xml = new MspdiWriter().write(project);
    expect(xml).toContain("<SaveVersion>14</SaveVersion>");
  });

  test("escapes XML special characters", () => {
    const project = createEmptyProject();
    project.properties.title = 'Test & <Project> "Name"';

    const xml = new MspdiWriter().write(project);
    expect(xml).toContain("Test &amp; &lt;Project&gt; &quot;Name&quot;");
  });

  test("omits null/empty fields", () => {
    const project = createEmptyProject();
    project.properties.title = null;
    project.properties.author = null;
    project.properties.statusDate = null;

    const xml = new MspdiWriter().write(project);
    expect(xml).not.toContain("<Title>");
    expect(xml).not.toContain("<Author>");
    expect(xml).not.toContain("<StatusDate>");
  });
});

// ---------------------------------------------------------------------------
// MSPDI round-trip tests (no MPP dependency)
// ---------------------------------------------------------------------------

describe("MSPDI round-trip", () => {
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
    expect(project.tasks[1]?.predecessors[0]?.lag?.toSimpleString()).toBe(
      "1.0d",
    );
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

  test("round-trips a project with calendars, tasks, resources, and assignments", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Title>Round Trip Test</Title>
  <Author>Test Author</Author>
  <StartDate>2026-04-01T08:00:00</StartDate>
  <FinishDate>2026-04-30T17:00:00</FinishDate>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <CalendarUID>1</CalendarUID>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <WeekDays>
        <WeekDay>
          <DayType>2</DayType>
          <DayWorking>1</DayWorking>
          <WorkingTimes>
            <WorkingTime>
              <FromTime>08:00:00</FromTime>
              <ToTime>17:00:00</ToTime>
            </WorkingTime>
          </WorkingTimes>
        </WeekDay>
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>
    <Task>
      <UID>0</UID>
      <ID>0</ID>
      <Name>Summary</Name>
      <OutlineLevel>0</OutlineLevel>
      <Summary>1</Summary>
      <Milestone>0</Milestone>
      <Critical>0</Critical>
    </Task>
    <Task>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Design Phase</Name>
      <WBS>1</WBS>
      <OutlineLevel>1</OutlineLevel>
      <Start>2026-04-01T08:00:00</Start>
      <Finish>2026-04-05T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration>
      <PercentComplete>50</PercentComplete>
      <Summary>0</Summary>
      <Milestone>0</Milestone>
      <Critical>1</Critical>
      <Priority>500</Priority>
    </Task>
    <Task>
      <UID>2</UID>
      <ID>2</ID>
      <Name>Build Phase</Name>
      <WBS>2</WBS>
      <OutlineLevel>1</OutlineLevel>
      <Start>2026-04-06T08:00:00</Start>
      <Finish>2026-04-20T17:00:00</Finish>
      <Duration>PT80H0M0S</Duration>
      <PercentComplete>0</PercentComplete>
      <Summary>0</Summary>
      <Milestone>0</Milestone>
      <Critical>1</Critical>
      <PredecessorLink>
        <PredecessorUID>1</PredecessorUID>
        <Type>0</Type>
        <LinkLag>0</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>
    </Task>
  </Tasks>
  <Resources>
    <Resource>
      <UID>1</UID>
      <ID>1</ID>
      <Name>Developer</Name>
      <Type>1</Type>
      <EmailAddress>dev@example.com</EmailAddress>
      <MaxUnits>1.0</MaxUnits>
    </Resource>
  </Resources>
  <Assignments>
    <Assignment>
      <TaskUID>1</TaskUID>
      <ResourceUID>1</ResourceUID>
      <Work>PT40H0M0S</Work>
      <Units>1.0</Units>
      <Start>2026-04-01T08:00:00</Start>
      <Finish>2026-04-05T17:00:00</Finish>
    </Assignment>
  </Assignments>
</Project>`;

    const reader = new MspdiReader();
    const writer = new MspdiWriter();

    const project = reader.read(xml);
    const written = writer.write(project, { saveVersion: 14 });
    const roundTripped = reader.read(written);

    // Verify structure is preserved
    expect(roundTripped.properties.title).toBe("Round Trip Test");
    expect(roundTripped.properties.author).toBe("Test Author");
    expect(roundTripped.properties.saveVersion).toBe(14);
    expect(roundTripped.properties.defaultCalendarUniqueId).toBe(1);

    expect(roundTripped.calendars).toHaveLength(1);
    expect(roundTripped.calendars[0]?.name).toBe("Standard");

    expect(roundTripped.tasks).toHaveLength(3);
    expect(roundTripped.tasks[0]?.name).toBe("Summary");
    expect(roundTripped.tasks[0]?.summary).toBe(true);
    expect(roundTripped.tasks[1]?.name).toBe("Design Phase");
    expect(roundTripped.tasks[1]?.percentComplete).toBe(50);
    expect(roundTripped.tasks[1]?.critical).toBe(true);
    expect(roundTripped.tasks[1]?.duration?.toSimpleString()).toBe("1.0w");
    expect(roundTripped.tasks[2]?.name).toBe("Build Phase");
    expect(roundTripped.tasks[2]?.predecessors).toHaveLength(1);
    expect(roundTripped.tasks[2]?.predecessors[0]?.type).toBe(RelationType.FinishToStart);

    expect(roundTripped.resources).toHaveLength(1);
    expect(roundTripped.resources[0]?.name).toBe("Developer");
    expect(roundTripped.resources[0]?.email).toBe("dev@example.com");
    expect(roundTripped.resources[0]?.maxUnits).toBe(100);

    expect(roundTripped.assignments).toHaveLength(1);
    expect(roundTripped.assignments[0]?.units).toBe(100);
    expect(roundTripped.assignments[0]?.work?.toSimpleString()).toBe("1.0w");
  });

  test("round-trips all relation types", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>A</Name></Task>
    <Task><UID>2</UID><ID>2</ID><Name>B</Name>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>0</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
    <Task><UID>3</UID><ID>3</ID><Name>C</Name>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
    <Task><UID>4</UID><ID>4</ID><Name>D</Name>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>2</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
    <Task><UID>5</UID><ID>5</ID><Name>E</Name>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>3</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
  </Tasks>
</Project>`;

    const project = new MspdiReader().read(xml);
    expect(project.tasks[1]?.predecessors[0]?.type).toBe(RelationType.FinishToStart);
    expect(project.tasks[2]?.predecessors[0]?.type).toBe(RelationType.StartToStart);
    expect(project.tasks[3]?.predecessors[0]?.type).toBe(RelationType.FinishToFinish);
    expect(project.tasks[4]?.predecessors[0]?.type).toBe(RelationType.StartToFinish);

    const written = new MspdiWriter().write(project);
    expect(written).toContain("<Type>0</Type>");
    expect(written).toContain("<Type>1</Type>");
    expect(written).toContain("<Type>2</Type>");
    expect(written).toContain("<Type>3</Type>");
  });

  test("round-trips calendar exceptions", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <Exceptions>
        <Exception>
          <Name>Christmas</Name>
          <FromDate>2026-12-25T00:00:00</FromDate>
          <ToDate>2026-12-25T00:00:00</ToDate>
          <Working>0</Working>
        </Exception>
      </Exceptions>
    </Calendar>
  </Calendars>
</Project>`;

    const project = new MspdiReader().read(xml);
    const written = new MspdiWriter().write(project);
    const roundTripped = new MspdiReader().read(written);

    expect(roundTripped.calendars[0]?.exceptions).toHaveLength(1);
    expect(roundTripped.calendars[0]?.exceptions[0]?.name).toBe("Christmas");
    expect(roundTripped.calendars[0]?.exceptions[0]?.working).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests that require an MPP file (skipped since no fixture available)
// ---------------------------------------------------------------------------

describe("MSPDI with MPP fixture", () => {
  test.skip("round-trips the fixture project through MSPDI XML", () => {
    // This test requires an MPP fixture file and MppReader
    // It will be enabled once the MPP reader layer is complete
  });
});
