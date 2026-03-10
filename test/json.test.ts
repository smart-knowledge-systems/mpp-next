import { describe, expect, test } from "bun:test";

import { JsonReader } from "../src/json/JsonReader.ts";
import { JsonWriter } from "../src/json/JsonWriter.ts";
import { Duration } from "../src/model/Duration.ts";
import { createEmptyProject } from "../src/model/Project.ts";
import { TimeUnit, RelationType, ResourceType, ConstraintType } from "../src/model/types.ts";

// ---------------------------------------------------------------------------
// JsonWriter tests
// ---------------------------------------------------------------------------

describe("JsonWriter", () => {
  test("serializes a minimal empty project", () => {
    const project = createEmptyProject();
    project.properties.title = "Test Project";
    project.properties.author = "Tester";

    const writer = new JsonWriter();
    const json = writer.write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed).toHaveProperty("properties");
    expect(parsed).toHaveProperty("tasks");
    expect(parsed).toHaveProperty("resources");
    expect(parsed).toHaveProperty("assignments");
    expect(parsed).toHaveProperty("calendars");

    const props = parsed["properties"] as Record<string, unknown>;
    expect(props["title"]).toBe("Test Project");
    expect(props["author"]).toBe("Tester");
    expect(props["minutesPerDay"]).toBe(480);
    expect(props["minutesPerWeek"]).toBe(2400);
    expect(props["daysPerMonth"]).toBe(20);
  });

  test("serializes Duration objects as { duration, units }", () => {
    const project = createEmptyProject();
    project.tasks.push({
      id: 1,
      uniqueId: 1,
      name: "Task with duration",
      wbs: null,
      outlineLevel: 1,
      start: null,
      finish: null,
      duration: Duration.from(8, TimeUnit.Hours),
      percentComplete: null,
      summary: false,
      milestone: false,
      critical: false,
      notes: null,
      priority: null,
      cost: null,
      work: Duration.from(2, TimeUnit.Days),
      actualWork: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      baselineDuration: null,
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

    const json = new JsonWriter().write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const tasks = parsed["tasks"] as Record<string, unknown>[];
    const task = tasks[0] as Record<string, unknown>;

    expect(task["duration"]).toEqual({ duration: 8, units: "hours" });
    expect(task["work"]).toEqual({ duration: 2, units: "days" });
  });

  test("serializes Date objects as ISO 8601 strings", () => {
    const project = createEmptyProject();
    const startDate = new Date(2024, 0, 15, 8, 0, 0); // Jan 15, 2024 08:00:00
    project.properties.startDate = startDate;

    project.tasks.push({
      id: 1,
      uniqueId: 1,
      name: "Dated task",
      wbs: null,
      outlineLevel: 1,
      start: new Date(2024, 0, 15, 8, 0, 0),
      finish: new Date(2024, 0, 15, 17, 0, 0),
      duration: null,
      percentComplete: null,
      summary: false,
      milestone: false,
      critical: false,
      notes: null,
      priority: null,
      cost: null,
      work: null,
      actualWork: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      baselineDuration: null,
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

    const json = new JsonWriter().write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const props = parsed["properties"] as Record<string, unknown>;
    expect(props["startDate"]).toBe("2024-01-15T08:00:00");

    const tasks = parsed["tasks"] as Record<string, unknown>[];
    const task = tasks[0] as Record<string, unknown>;
    expect(task["start"]).toBe("2024-01-15T08:00:00");
    expect(task["finish"]).toBe("2024-01-15T17:00:00");
  });

  test("preserves null fields", () => {
    const project = createEmptyProject();
    project.properties.title = null;
    project.properties.author = null;
    project.properties.startDate = null;

    const json = new JsonWriter().write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const props = parsed["properties"] as Record<string, unknown>;

    expect(props["title"]).toBeNull();
    expect(props["author"]).toBeNull();
    expect(props["startDate"]).toBeNull();

    // Verify the keys actually exist (not omitted)
    expect("title" in props).toBe(true);
    expect("author" in props).toBe(true);
    expect("startDate" in props).toBe(true);
  });

  test("pretty output uses indentation (default)", () => {
    const project = createEmptyProject();
    project.properties.title = "Pretty";

    const json = new JsonWriter().write(project);
    // Pretty output should have newlines and indentation
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });

  test("compact output has no indentation", () => {
    const project = createEmptyProject();
    project.properties.title = "Compact";

    const json = new JsonWriter().write(project, { pretty: false });
    // Compact should be a single line
    expect(json).not.toContain("\n");
    expect(json).not.toContain("  ");
  });

  test("pretty: true explicitly produces indented output", () => {
    const project = createEmptyProject();
    project.properties.title = "Explicit Pretty";

    const json = new JsonWriter().write(project, { pretty: true });
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });

  test("serializes a full project with tasks, resources, assignments, and calendars", () => {
    const project = createEmptyProject();
    project.properties.title = "Full Project";
    project.properties.author = "Author";
    project.properties.startDate = new Date(2024, 0, 1, 8, 0, 0);
    project.properties.finishDate = new Date(2024, 5, 30, 17, 0, 0);
    project.properties.defaultCalendarUniqueId = 1;

    project.calendars.push({
      uniqueId: 1,
      name: "Standard",
      weekDays: [
        { dayType: 2, working: true, workingTimes: [{ from: "08:00:00", to: "17:00:00" }] },
      ],
      exceptions: [
        {
          name: "Holiday",
          fromDate: new Date(2024, 11, 25, 0, 0, 0),
          toDate: new Date(2024, 11, 25, 0, 0, 0),
          working: false,
        },
      ],
    });

    project.tasks.push({
      id: 1,
      uniqueId: 1,
      name: "Design",
      wbs: "1",
      outlineLevel: 1,
      start: new Date(2024, 0, 1, 8, 0, 0),
      finish: new Date(2024, 0, 5, 17, 0, 0),
      duration: Duration.from(5, TimeUnit.Days),
      percentComplete: 50,
      summary: false,
      milestone: false,
      critical: true,
      notes: "Design notes",
      priority: 500,
      cost: 1000,
      work: Duration.from(40, TimeUnit.Hours),
      actualWork: null,
      actualStart: new Date(2024, 0, 1, 8, 0, 0),
      actualFinish: null,
      baselineStart: new Date(2024, 0, 1, 8, 0, 0),
      baselineFinish: new Date(2024, 0, 5, 17, 0, 0),
      baselineDuration: Duration.from(5, TimeUnit.Days),
      constraintType: ConstraintType.AsSoonAsPossible,
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

    project.tasks.push({
      id: 2,
      uniqueId: 2,
      name: "Build",
      wbs: "2",
      outlineLevel: 1,
      start: new Date(2024, 0, 8, 8, 0, 0),
      finish: new Date(2024, 0, 19, 17, 0, 0),
      duration: Duration.from(10, TimeUnit.Days),
      percentComplete: 0,
      summary: false,
      milestone: false,
      critical: true,
      notes: null,
      priority: 500,
      cost: 2000,
      work: Duration.from(80, TimeUnit.Hours),
      actualWork: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      baselineDuration: null,
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
      predecessors: [
        {
          predecessorUniqueId: 1,
          successorUniqueId: 2,
          type: RelationType.FinishToStart,
          lag: Duration.from(0, TimeUnit.Days),
        },
      ],
    });

    project.resources.push({
      id: 1,
      uniqueId: 1,
      name: "Developer",
      type: ResourceType.Work,
      email: "dev@example.com",
      group: "Engineering",
      maxUnits: 100,
      cost: 50,
      work: Duration.from(120, TimeUnit.Hours),
      resourcePool: null,
    });

    project.assignments.push({
      taskUniqueId: 1,
      resourceUniqueId: 1,
      work: Duration.from(40, TimeUnit.Hours),
      units: 100,
      start: new Date(2024, 0, 1, 8, 0, 0),
      finish: new Date(2024, 0, 5, 17, 0, 0),
      actualWork: null,
      remainingWork: null,
    });

    const json = new JsonWriter().write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    // Verify top-level keys
    const tasks = parsed["tasks"] as Record<string, unknown>[];
    const resources = parsed["resources"] as Record<string, unknown>[];
    const assignments = parsed["assignments"] as Record<string, unknown>[];
    const calendars = parsed["calendars"] as Record<string, unknown>[];

    expect(tasks).toHaveLength(2);
    expect(resources).toHaveLength(1);
    expect(assignments).toHaveLength(1);
    expect(calendars).toHaveLength(1);

    // Verify predecessor relation with lag Duration
    const task2 = tasks[1] as Record<string, unknown>;
    const preds = task2["predecessors"] as Record<string, unknown>[];
    expect(preds).toHaveLength(1);
    expect(preds[0]!["type"]).toBe("FS");
    expect(preds[0]!["lag"]).toEqual({ duration: 0, units: "days" });

    // Verify resource
    const resource = resources[0] as Record<string, unknown>;
    expect(resource["name"]).toBe("Developer");
    expect(resource["type"]).toBe("Work");
    expect(resource["email"]).toBe("dev@example.com");
    expect(resource["work"]).toEqual({ duration: 120, units: "hours" });

    // Verify calendar exception date serialization
    const cal = calendars[0] as Record<string, unknown>;
    const exceptions = cal["exceptions"] as Record<string, unknown>[];
    expect(exceptions[0]!["fromDate"]).toBe("2024-12-25T00:00:00");
  });

  test("round-trip: write to JSON, parse back, verify fields match", () => {
    const project = createEmptyProject();
    project.properties.title = "Round Trip";
    project.properties.author = "Author";
    project.properties.startDate = new Date(2024, 2, 1, 9, 0, 0);
    project.properties.minutesPerDay = 480;
    project.properties.minutesPerWeek = 2400;
    project.properties.daysPerMonth = 20;

    project.tasks.push({
      id: 1,
      uniqueId: 1,
      name: "Task A",
      wbs: "1",
      outlineLevel: 1,
      start: new Date(2024, 2, 1, 9, 0, 0),
      finish: new Date(2024, 2, 3, 17, 0, 0),
      duration: Duration.from(3, TimeUnit.Days),
      percentComplete: 25,
      summary: false,
      milestone: false,
      critical: false,
      notes: "Some notes",
      priority: 500,
      cost: 100,
      work: Duration.from(24, TimeUnit.Hours),
      actualWork: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      baselineDuration: null,
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

    const json = new JsonWriter().write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    const props = parsed["properties"] as Record<string, unknown>;
    expect(props["title"]).toBe("Round Trip");
    expect(props["author"]).toBe("Author");
    expect(props["startDate"]).toBe("2024-03-01T09:00:00");
    expect(props["minutesPerDay"]).toBe(480);
    expect(props["minutesPerWeek"]).toBe(2400);
    expect(props["daysPerMonth"]).toBe(20);

    const tasks = parsed["tasks"] as Record<string, unknown>[];
    const task = tasks[0] as Record<string, unknown>;
    expect(task["id"]).toBe(1);
    expect(task["uniqueId"]).toBe(1);
    expect(task["name"]).toBe("Task A");
    expect(task["wbs"]).toBe("1");
    expect(task["outlineLevel"]).toBe(1);
    expect(task["start"]).toBe("2024-03-01T09:00:00");
    expect(task["finish"]).toBe("2024-03-03T17:00:00");
    expect(task["duration"]).toEqual({ duration: 3, units: "days" });
    expect(task["percentComplete"]).toBe(25);
    expect(task["summary"]).toBe(false);
    expect(task["milestone"]).toBe(false);
    expect(task["critical"]).toBe(false);
    expect(task["notes"]).toBe("Some notes");
    expect(task["priority"]).toBe(500);
    expect(task["cost"]).toBe(100);
    expect(task["work"]).toEqual({ duration: 24, units: "hours" });
    expect(task["actualStart"]).toBeNull();
    expect(task["actualFinish"]).toBeNull();
    expect(task["baselineStart"]).toBeNull();
    expect(task["baselineFinish"]).toBeNull();
    expect(task["baselineDuration"]).toBeNull();
    expect(task["constraintType"]).toBeNull();
    expect(task["predecessors"]).toEqual([]);
  });

  test("serializes Duration in assignment work field", () => {
    const project = createEmptyProject();
    project.assignments.push({
      taskUniqueId: 1,
      resourceUniqueId: 2,
      work: Duration.from(16, TimeUnit.Hours),
      units: 50,
      start: new Date(2024, 3, 1, 8, 0, 0),
      finish: new Date(2024, 3, 2, 17, 0, 0),
      actualWork: null,
      remainingWork: null,
    });

    const json = new JsonWriter().write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const assignments = parsed["assignments"] as Record<string, unknown>[];
    const assignment = assignments[0] as Record<string, unknown>;

    expect(assignment["work"]).toEqual({ duration: 16, units: "hours" });
    expect(assignment["units"]).toBe(50);
    expect(assignment["start"]).toBe("2024-04-01T08:00:00");
    expect(assignment["finish"]).toBe("2024-04-02T17:00:00");
  });

  test("serializes Duration with various time units", () => {
    const project = createEmptyProject();

    project.tasks.push({
      id: 1,
      uniqueId: 1,
      name: "Minutes task",
      wbs: null,
      outlineLevel: 1,
      start: null,
      finish: null,
      duration: Duration.from(30, TimeUnit.Minutes),
      percentComplete: null,
      summary: false,
      milestone: false,
      critical: false,
      notes: null,
      priority: null,
      cost: null,
      work: Duration.from(2, TimeUnit.Weeks),
      actualWork: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      baselineDuration: Duration.from(3, TimeUnit.Months),
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

    const json = new JsonWriter().write(project);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const tasks = parsed["tasks"] as Record<string, unknown>[];
    const task = tasks[0] as Record<string, unknown>;

    expect(task["duration"]).toEqual({ duration: 30, units: "minutes" });
    expect(task["work"]).toEqual({ duration: 2, units: "weeks" });
    expect(task["baselineDuration"]).toEqual({ duration: 3, units: "months" });
  });
});

describe("JsonReader", () => {
  const reader = new JsonReader();
  const writer = new JsonWriter();

  test("reads a minimal empty project", () => {
    const project = reader.read("{}");
    expect(project.properties.title).toBeNull();
    expect(project.properties.minutesPerDay).toBe(480);
    expect(project.tasks).toEqual([]);
    expect(project.resources).toEqual([]);
    expect(project.assignments).toEqual([]);
    expect(project.calendars).toEqual([]);
  });

  test("reads properties", () => {
    const json = JSON.stringify({
      properties: {
        title: "Test",
        author: "Author",
        startDate: "2024-06-01T08:00:00",
        minutesPerDay: 960,
        saveVersion: 14,
      },
    });
    const project = reader.read(json);
    expect(project.properties.title).toBe("Test");
    expect(project.properties.author).toBe("Author");
    expect(project.properties.startDate).toBeInstanceOf(Date);
    expect(project.properties.minutesPerDay).toBe(960);
    expect(project.properties.saveVersion).toBe(14);
  });

  test("reads Duration objects from {duration, units} format", () => {
    const json = JSON.stringify({
      tasks: [
        {
          id: 1,
          uniqueId: 1,
          name: "Task",
          duration: { duration: 8, units: "hours" },
          work: { duration: 5, units: "days" },
          predecessors: [],
        },
      ],
    });
    const project = reader.read(json);
    const task = project.tasks[0]!;
    expect(task.duration).toBeInstanceOf(Duration);
    expect(task.duration!.value).toBe(8);
    expect(task.duration!.unit).toBe(TimeUnit.Hours);
    expect(task.work!.value).toBe(5);
    expect(task.work!.unit).toBe(TimeUnit.Days);
  });

  test("reads Date strings back to Date objects", () => {
    const json = JSON.stringify({
      tasks: [
        {
          id: 1,
          uniqueId: 1,
          name: "Task",
          start: "2024-03-15T09:00:00",
          finish: "2024-03-15T17:00:00",
          predecessors: [],
        },
      ],
    });
    const project = reader.read(json);
    const task = project.tasks[0]!;
    expect(task.start).toBeInstanceOf(Date);
    expect(task.finish).toBeInstanceOf(Date);
  });

  test("preserves null fields", () => {
    const json = JSON.stringify({
      tasks: [
        {
          id: null,
          name: null,
          duration: null,
          start: null,
          predecessors: [],
        },
      ],
    });
    const project = reader.read(json);
    const task = project.tasks[0]!;
    expect(task.id).toBeNull();
    expect(task.name).toBeNull();
    expect(task.duration).toBeNull();
    expect(task.start).toBeNull();
  });

  test("reads relations with type and lag", () => {
    const json = JSON.stringify({
      tasks: [
        {
          id: 2,
          uniqueId: 2,
          name: "Successor",
          predecessors: [
            {
              predecessorUniqueId: 1,
              successorUniqueId: 2,
              type: "SS",
              lag: { duration: 2, units: "days" },
            },
          ],
        },
      ],
    });
    const project = reader.read(json);
    const rel = project.tasks[0]!.predecessors[0]!;
    expect(rel.type).toBe(RelationType.StartToStart);
    expect(rel.lag!.value).toBe(2);
    expect(rel.lag!.unit).toBe(TimeUnit.Days);
  });

  test("reads resources with type and pool", () => {
    const json = JSON.stringify({
      resources: [
        {
          id: 1,
          uniqueId: 1,
          name: "Crane",
          type: "Material",
          resourcePool: "Equipment Pool",
        },
      ],
    });
    const project = reader.read(json);
    const res = project.resources[0]!;
    expect(res.type).toBe(ResourceType.Material);
    expect(res.resourcePool).toBe("Equipment Pool");
  });

  test("reads assignments with work fields", () => {
    const json = JSON.stringify({
      assignments: [
        {
          taskUniqueId: 1,
          resourceUniqueId: 2,
          work: { duration: 16, units: "hours" },
          units: 100,
          actualWork: { duration: 8, units: "hours" },
          remainingWork: { duration: 8, units: "hours" },
        },
      ],
    });
    const project = reader.read(json);
    const assn = project.assignments[0]!;
    expect(assn.actualWork!.value).toBe(8);
    expect(assn.remainingWork!.value).toBe(8);
  });

  test("reads calendars with weekdays and exceptions", () => {
    const json = JSON.stringify({
      calendars: [
        {
          uniqueId: 1,
          name: "Standard",
          weekDays: [
            { dayType: 2, working: true, workingTimes: [{ from: "09:00:00", to: "17:00:00" }] },
          ],
          exceptions: [{ name: "Holiday", fromDate: "2024-12-25T00:00:00", working: false }],
        },
      ],
    });
    const project = reader.read(json);
    const cal = project.calendars[0]!;
    expect(cal.weekDays[0]!.dayType).toBe(2);
    expect(cal.weekDays[0]!.working).toBe(true);
    expect(cal.exceptions[0]!.name).toBe("Holiday");
    expect(cal.exceptions[0]!.fromDate).toBeInstanceOf(Date);
  });

  test("reads scheduling fields on tasks", () => {
    const json = JSON.stringify({
      tasks: [
        {
          id: 1,
          uniqueId: 1,
          name: "Task",
          freeSlack: { duration: 0, units: "minutes" },
          totalSlack: { duration: 480, units: "minutes" },
          earlyStart: "2024-01-15T08:00:00",
          lateFinish: "2024-01-20T17:00:00",
          deadline: "2024-01-25T00:00:00",
          predecessors: [],
        },
      ],
    });
    const project = reader.read(json);
    const task = project.tasks[0]!;
    expect(task.freeSlack!.value).toBe(0);
    expect(task.totalSlack!.value).toBe(480);
    expect(task.earlyStart).toBeInstanceOf(Date);
    expect(task.lateFinish).toBeInstanceOf(Date);
    expect(task.deadline).toBeInstanceOf(Date);
  });

  test("full round-trip: write then read preserves data", () => {
    const original = createEmptyProject();
    original.properties.title = "Round Trip";
    original.properties.startDate = new Date(2024, 5, 1, 8, 0, 0);
    original.tasks = [
      {
        id: 1,
        uniqueId: 1,
        name: "Task A",
        wbs: "1",
        outlineLevel: 1,
        start: new Date(2024, 5, 1, 8, 0, 0),
        finish: new Date(2024, 5, 1, 17, 0, 0),
        duration: Duration.from(8, TimeUnit.Hours),
        percentComplete: 50,
        summary: false,
        milestone: false,
        critical: true,
        notes: null,
        priority: 500,
        cost: 1000,
        work: Duration.from(8, TimeUnit.Hours),
        actualStart: null,
        actualFinish: null,
        baselineStart: null,
        baselineFinish: null,
        baselineDuration: null,
        actualWork: null,
        constraintType: null,
        freeSlack: Duration.from(0, TimeUnit.Minutes),
        totalSlack: Duration.from(0, TimeUnit.Minutes),
        earlyStart: new Date(2024, 5, 1, 8, 0, 0),
        earlyFinish: new Date(2024, 5, 1, 17, 0, 0),
        lateStart: new Date(2024, 5, 1, 8, 0, 0),
        lateFinish: new Date(2024, 5, 1, 17, 0, 0),
        levelingDelay: null,
        deadline: null,
        splits: null,
        predecessors: [],
      },
    ];

    const json = writer.write(original);
    const restored = reader.read(json);

    expect(restored.properties.title).toBe("Round Trip");
    expect(restored.tasks.length).toBe(1);
    const task = restored.tasks[0]!;
    expect(task.name).toBe("Task A");
    expect(task.duration!.value).toBe(8);
    expect(task.duration!.unit).toBe(TimeUnit.Hours);
    expect(task.percentComplete).toBe(50);
    expect(task.critical).toBe(true);
    expect(task.cost).toBe(1000);
    expect(task.freeSlack!.value).toBe(0);
    expect(task.earlyStart).toBeInstanceOf(Date);
  });
});
