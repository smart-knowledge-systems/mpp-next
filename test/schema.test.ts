import { describe, expect, test } from "bun:test";

import { Duration } from "../src/model/Duration.ts";
import { TimeUnit } from "../src/model/types.ts";
import {
  ProjectFileSchema,
  TaskSchema,
  ResourceSchema,
  AssignmentSchema,
  CalendarSchema,
  RelationSchema,
  DurationSchema,
  NullableDurationSchema,
  DateStringSchema,
  NullableDateStringSchema,
  TimeUnitSchema,
  RelationTypeSchema,
  ResourceTypeSchema,
  ConstraintTypeSchema,
} from "../src/schema/index.ts";

describe("enum schemas", () => {
  test("TimeUnitSchema accepts valid values", () => {
    expect(TimeUnitSchema.parse("hours")).toBe("hours");
    expect(TimeUnitSchema.parse("days")).toBe("days");
    expect(TimeUnitSchema.parse("minutes")).toBe("minutes");
  });

  test("TimeUnitSchema rejects invalid values", () => {
    expect(() => TimeUnitSchema.parse("invalid")).toThrow();
    expect(() => TimeUnitSchema.parse(42)).toThrow();
  });

  test("RelationTypeSchema accepts valid values", () => {
    expect(RelationTypeSchema.parse("FS")).toBe("FS");
    expect(RelationTypeSchema.parse("SS")).toBe("SS");
    expect(RelationTypeSchema.parse("FF")).toBe("FF");
    expect(RelationTypeSchema.parse("SF")).toBe("SF");
  });

  test("RelationTypeSchema rejects invalid values", () => {
    expect(() => RelationTypeSchema.parse("XX")).toThrow();
  });

  test("ResourceTypeSchema accepts valid values", () => {
    expect(ResourceTypeSchema.parse("Work")).toBe("Work");
    expect(ResourceTypeSchema.parse("Material")).toBe("Material");
    expect(ResourceTypeSchema.parse("Cost")).toBe("Cost");
  });

  test("ConstraintTypeSchema accepts valid values", () => {
    expect(ConstraintTypeSchema.parse("ASAP")).toBe("ASAP");
    expect(ConstraintTypeSchema.parse("MFO")).toBe("MFO");
  });

  test("ConstraintTypeSchema rejects invalid values", () => {
    expect(() => ConstraintTypeSchema.parse("INVALID")).toThrow();
  });
});

describe("DateStringSchema", () => {
  test("transforms valid date string to Date", () => {
    const result = DateStringSchema.parse("2024-06-15T09:00:00");
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2024);
  });

  test("rejects invalid date string", () => {
    expect(() => DateStringSchema.parse("not-a-date")).toThrow();
  });

  test("NullableDateStringSchema handles null", () => {
    expect(NullableDateStringSchema.parse(null)).toBeNull();
  });

  test("NullableDateStringSchema handles empty string", () => {
    expect(NullableDateStringSchema.parse("")).toBeNull();
  });

  test("NullableDateStringSchema transforms valid string", () => {
    const result = NullableDateStringSchema.parse("2024-01-01T00:00:00");
    expect(result).toBeInstanceOf(Date);
  });
});

describe("DurationSchema", () => {
  test("transforms to Duration instance", () => {
    const result = DurationSchema.parse({ duration: 8, units: "hours" });
    expect(result).toBeInstanceOf(Duration);
    expect(result.value).toBe(8);
    expect(result.unit).toBe(TimeUnit.Hours);
  });

  test("rejects invalid units", () => {
    expect(() => DurationSchema.parse({ duration: 8, units: "invalid" })).toThrow();
  });

  test("rejects missing fields", () => {
    expect(() => DurationSchema.parse({ duration: 8 })).toThrow();
    expect(() => DurationSchema.parse({ units: "hours" })).toThrow();
  });

  test("NullableDurationSchema handles null", () => {
    expect(NullableDurationSchema.parse(null)).toBeNull();
  });

  test("NullableDurationSchema transforms valid object", () => {
    const result = NullableDurationSchema.parse({ duration: 5, units: "days" });
    expect(result).toBeInstanceOf(Duration);
    expect(result!.value).toBe(5);
  });
});

describe("RelationSchema", () => {
  test("parses a valid relation", () => {
    const result = RelationSchema.parse({
      predecessorUniqueId: 1,
      successorUniqueId: 2,
      type: "FS",
      lag: { duration: 1, units: "days" },
    });
    expect(result.predecessorUniqueId).toBe(1);
    expect(result.type).toBe("FS");
    expect(result.lag).toBeInstanceOf(Duration);
  });

  test("accepts null lag", () => {
    const result = RelationSchema.parse({
      predecessorUniqueId: 1,
      successorUniqueId: 2,
      type: "SS",
      lag: null,
    });
    expect(result.lag).toBeNull();
  });

  test("rejects invalid relation type", () => {
    expect(() =>
      RelationSchema.parse({
        predecessorUniqueId: 1,
        successorUniqueId: 2,
        type: "INVALID",
        lag: null,
      }),
    ).toThrow();
  });
});

describe("TaskSchema", () => {
  test("parses a full task", () => {
    const result = TaskSchema.parse({
      id: 1,
      uniqueId: 1,
      name: "Task A",
      wbs: "1.1",
      outlineLevel: 2,
      start: "2024-06-01T08:00:00",
      finish: "2024-06-01T17:00:00",
      duration: { duration: 8, units: "hours" },
      percentComplete: 50,
      summary: false,
      milestone: false,
      critical: true,
      notes: "Some notes",
      priority: 500,
      cost: 1000,
      work: { duration: 8, units: "hours" },
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      baselineDuration: null,
      actualWork: null,
      constraintType: "ASAP",
      freeSlack: { duration: 0, units: "minutes" },
      totalSlack: { duration: 480, units: "minutes" },
      earlyStart: "2024-06-01T08:00:00",
      earlyFinish: "2024-06-01T17:00:00",
      lateStart: null,
      lateFinish: null,
      levelingDelay: null,
      deadline: null,
      splits: null,
      predecessors: [{ predecessorUniqueId: 0, successorUniqueId: 1, type: "FS", lag: null }],
    });
    expect(result.name).toBe("Task A");
    expect(result.start).toBeInstanceOf(Date);
    expect(result.duration).toBeInstanceOf(Duration);
    expect(result.duration!.value).toBe(8);
    expect(result.freeSlack).toBeInstanceOf(Duration);
    expect(result.predecessors.length).toBe(1);
    expect(result.constraintType).toBe("ASAP");
  });

  test("rejects missing required fields", () => {
    expect(() => TaskSchema.parse({ id: 1 })).toThrow();
  });

  test("parses task with all nulls", () => {
    const result = TaskSchema.parse({
      id: null,
      uniqueId: null,
      name: null,
      wbs: null,
      outlineLevel: null,
      start: null,
      finish: null,
      duration: null,
      percentComplete: null,
      summary: null,
      milestone: null,
      critical: null,
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
    });
    expect(result.id).toBeNull();
    expect(result.duration).toBeNull();
    expect(result.start).toBeNull();
  });
});

describe("ResourceSchema", () => {
  test("parses a valid resource", () => {
    const result = ResourceSchema.parse({
      id: 1,
      uniqueId: 1,
      name: "Engineer",
      type: "Work",
      email: "eng@example.com",
      group: "Dev",
      maxUnits: 100,
      cost: 500,
      work: { duration: 40, units: "hours" },
      resourcePool: null,
    });
    expect(result.name).toBe("Engineer");
    expect(result.work).toBeInstanceOf(Duration);
  });

  test("rejects invalid resource type", () => {
    expect(() =>
      ResourceSchema.parse({
        id: 1,
        uniqueId: 1,
        name: "X",
        type: "Invalid",
        email: null,
        group: null,
        maxUnits: null,
        cost: null,
        work: null,
        resourcePool: null,
      }),
    ).toThrow();
  });
});

describe("AssignmentSchema", () => {
  test("parses a valid assignment", () => {
    const result = AssignmentSchema.parse({
      taskUniqueId: 1,
      resourceUniqueId: 2,
      work: { duration: 16, units: "hours" },
      units: 100,
      start: "2024-06-01T08:00:00",
      finish: "2024-06-02T17:00:00",
      actualWork: { duration: 8, units: "hours" },
      remainingWork: { duration: 8, units: "hours" },
    });
    expect(result.work).toBeInstanceOf(Duration);
    expect(result.actualWork).toBeInstanceOf(Duration);
    expect(result.start).toBeInstanceOf(Date);
  });
});

describe("CalendarSchema", () => {
  test("parses a valid calendar", () => {
    const result = CalendarSchema.parse({
      uniqueId: 1,
      name: "Standard",
      weekDays: [
        {
          dayType: 2,
          working: true,
          workingTimes: [
            { from: "08:00:00", to: "12:00:00" },
            { from: "13:00:00", to: "17:00:00" },
          ],
        },
      ],
      exceptions: [
        {
          name: "Holiday",
          fromDate: "2024-12-25T00:00:00",
          toDate: "2024-12-25T23:59:59",
          working: false,
        },
      ],
    });
    expect(result.name).toBe("Standard");
    expect(result.weekDays.length).toBe(1);
    expect(result.weekDays[0]!.workingTimes.length).toBe(2);
    expect(result.exceptions[0]!.fromDate).toBeInstanceOf(Date);
  });
});

describe("ProjectFileSchema", () => {
  test("parses a minimal project", () => {
    const result = ProjectFileSchema.parse({
      properties: {
        title: "Test",
        author: null,
        startDate: "2024-01-01T00:00:00",
        finishDate: null,
        statusDate: null,
        defaultCalendarUniqueId: null,
        minutesPerDay: 480,
        minutesPerWeek: 2400,
        daysPerMonth: 20,
        saveVersion: 14,
      },
      tasks: [],
      resources: [],
      assignments: [],
      calendars: [],
    });
    expect(result.properties.title).toBe("Test");
    expect(result.properties.startDate).toBeInstanceOf(Date);
    expect(result.tasks).toEqual([]);
  });

  test("rejects completely invalid input", () => {
    expect(() => ProjectFileSchema.parse("not an object")).toThrow();
    expect(() => ProjectFileSchema.parse(42)).toThrow();
    expect(() => ProjectFileSchema.parse(null)).toThrow();
  });

  test("validates JSON round-trip from JsonWriter", async () => {
    const { readMpp, writeJson } = await import("../src/index.ts");
    const project = await readMpp("test/sample-schedule.mpp");
    const json = writeJson(project);
    const parsed = JSON.parse(json) as unknown;
    const result = ProjectFileSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});
