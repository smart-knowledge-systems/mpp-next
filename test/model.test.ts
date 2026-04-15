import { test, expect, describe } from "bun:test";
import { Duration } from "../src/model/Duration.ts";
import { TimeUnit } from "../src/model/types.ts";
import { createEmptyProject } from "../src/model/Project.ts";
import { parseProjectDate, formatProjectDate } from "../src/dateTime.ts";

describe("Duration", () => {
  describe("constructor and from()", () => {
    test("creates duration with value and unit", () => {
      const d = new Duration(5, TimeUnit.Days);
      expect(d.value).toBe(5);
      expect(d.unit).toBe(TimeUnit.Days);
    });

    test("static from() creates same as constructor", () => {
      const d = Duration.from(8, TimeUnit.Hours);
      expect(d.value).toBe(8);
      expect(d.unit).toBe(TimeUnit.Hours);
    });
  });

  describe("parseSimple()", () => {
    test("parses minutes", () => {
      const d = Duration.parseSimple("30m");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(30);
      expect(d!.unit).toBe(TimeUnit.Minutes);
    });

    test("parses hours", () => {
      const d = Duration.parseSimple("8h");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(8);
      expect(d!.unit).toBe(TimeUnit.Hours);
    });

    test("parses days", () => {
      const d = Duration.parseSimple("5d");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(5);
      expect(d!.unit).toBe(TimeUnit.Days);
    });

    test("parses weeks", () => {
      const d = Duration.parseSimple("2w");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(2);
      expect(d!.unit).toBe(TimeUnit.Weeks);
    });

    test("parses decimal values", () => {
      const d = Duration.parseSimple("2.5d");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(2.5);
      expect(d!.unit).toBe(TimeUnit.Days);
    });

    test("parses negative values", () => {
      const d = Duration.parseSimple("-3d");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(-3);
      expect(d!.unit).toBe(TimeUnit.Days);
    });

    test("is case insensitive", () => {
      const d = Duration.parseSimple("5D");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(5);
      expect(d!.unit).toBe(TimeUnit.Days);
    });

    test("trims whitespace", () => {
      const d = Duration.parseSimple("  5d  ");
      expect(d).not.toBeNull();
      expect(d!.value).toBe(5);
    });

    test("returns null for null input", () => {
      expect(Duration.parseSimple(null)).toBeNull();
    });

    test("returns null for undefined input", () => {
      expect(Duration.parseSimple(undefined)).toBeNull();
    });

    test("returns null for empty string", () => {
      expect(Duration.parseSimple("")).toBeNull();
    });

    test("returns null for invalid format", () => {
      expect(Duration.parseSimple("abc")).toBeNull();
      expect(Duration.parseSimple("5x")).toBeNull();
      expect(Duration.parseSimple("5")).toBeNull();
    });
  });

  describe("toIso8601()", () => {
    test("formats weeks", () => {
      expect(new Duration(2, TimeUnit.Weeks).toIso8601()).toBe("P2W");
    });

    test("formats days", () => {
      expect(new Duration(5, TimeUnit.Days).toIso8601()).toBe("P5D");
    });

    test("formats hours", () => {
      expect(new Duration(8, TimeUnit.Hours).toIso8601()).toBe("PT8H0M0S");
    });

    test("formats minutes", () => {
      expect(new Duration(30, TimeUnit.Minutes).toIso8601()).toBe("PT0H30M0S");
    });

    test("formats months", () => {
      expect(new Duration(3, TimeUnit.Months).toIso8601()).toBe("P3M");
    });

    test("formats percent", () => {
      expect(new Duration(50, TimeUnit.Percent).toIso8601()).toBe("PT50M0S");
    });

    test("formats decimal values", () => {
      expect(new Duration(2.5, TimeUnit.Days).toIso8601()).toBe("P2.5D");
    });
  });

  describe("toSimpleString()", () => {
    test("formats integer minutes with .0", () => {
      expect(new Duration(30, TimeUnit.Minutes).toSimpleString()).toBe("30.0m");
    });

    test("formats integer hours with .0", () => {
      expect(new Duration(8, TimeUnit.Hours).toSimpleString()).toBe("8.0h");
    });

    test("formats integer days with .0", () => {
      expect(new Duration(5, TimeUnit.Days).toSimpleString()).toBe("5.0d");
    });

    test("formats integer weeks with .0", () => {
      expect(new Duration(2, TimeUnit.Weeks).toSimpleString()).toBe("2.0w");
    });

    test("formats months", () => {
      expect(new Duration(3, TimeUnit.Months).toSimpleString()).toBe("3.0mo");
    });

    test("formats percent", () => {
      expect(new Duration(50, TimeUnit.Percent).toSimpleString()).toBe("50.0%");
    });

    test("preserves decimal values without adding .0", () => {
      expect(new Duration(2.5, TimeUnit.Days).toSimpleString()).toBe("2.5d");
    });
  });

  describe("round-trip: parseSimple -> toSimpleString -> parseSimple", () => {
    test("round-trips minutes", () => {
      const original = Duration.parseSimple("30m")!;
      const text = original.toSimpleString();
      const parsed = Duration.parseSimple(text)!;
      expect(parsed.value).toBe(original.value);
      expect(parsed.unit).toBe(original.unit);
    });

    test("round-trips hours", () => {
      const original = Duration.parseSimple("8h")!;
      const text = original.toSimpleString();
      const parsed = Duration.parseSimple(text)!;
      expect(parsed.value).toBe(original.value);
      expect(parsed.unit).toBe(original.unit);
    });

    test("round-trips days", () => {
      const original = Duration.parseSimple("5d")!;
      const text = original.toSimpleString();
      const parsed = Duration.parseSimple(text)!;
      expect(parsed.value).toBe(original.value);
      expect(parsed.unit).toBe(original.unit);
    });

    test("round-trips weeks", () => {
      const original = Duration.parseSimple("2w")!;
      const text = original.toSimpleString();
      const parsed = Duration.parseSimple(text)!;
      expect(parsed.value).toBe(original.value);
      expect(parsed.unit).toBe(original.unit);
    });

    test("round-trips decimal values", () => {
      const original = Duration.parseSimple("2.5d")!;
      const text = original.toSimpleString();
      const parsed = Duration.parseSimple(text)!;
      expect(parsed.value).toBe(original.value);
      expect(parsed.unit).toBe(original.unit);
    });
  });

});

describe("createEmptyProject()", () => {
  test("returns project with default properties", () => {
    const project = createEmptyProject();
    expect(project.properties.title).toBeNull();
    expect(project.properties.author).toBeNull();
    expect(project.properties.startDate).toBeNull();
    expect(project.properties.finishDate).toBeNull();
    expect(project.properties.statusDate).toBeNull();
    expect(project.properties.defaultCalendarUniqueId).toBeNull();
    expect(project.properties.minutesPerDay).toBe(480);
    expect(project.properties.minutesPerWeek).toBe(2400);
    expect(project.properties.daysPerMonth).toBe(20);
    expect(project.properties.saveVersion).toBeNull();
  });

  test("returns project with empty collections", () => {
    const project = createEmptyProject();
    expect(project.tasks).toEqual([]);
    expect(project.resources).toEqual([]);
    expect(project.assignments).toEqual([]);
    expect(project.calendars).toEqual([]);
  });
});

describe("parseProjectDate()", () => {
  test("parses ISO date string", () => {
    const d = parseProjectDate("2024-01-15T09:00:00");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(15);
  });

  test("returns null for null", () => {
    expect(parseProjectDate(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(parseProjectDate(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseProjectDate("")).toBeNull();
  });
});

describe("formatProjectDate()", () => {
  test("formats date as ISO-like string", () => {
    const d = new Date(2024, 0, 15, 9, 30, 45);
    const result = formatProjectDate(d);
    expect(result).toBe("2024-01-15T09:30:45");
  });

  test("pads single-digit components", () => {
    const d = new Date(2024, 0, 5, 1, 2, 3);
    const result = formatProjectDate(d);
    expect(result).toBe("2024-01-05T01:02:03");
  });

  test("returns null for null", () => {
    expect(formatProjectDate(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(formatProjectDate(undefined)).toBeNull();
  });
});

describe("parseProjectDate/formatProjectDate round-trip", () => {
  test("round-trips a date", () => {
    const original = new Date(2024, 5, 15, 14, 30, 0);
    const formatted = formatProjectDate(original)!;
    const parsed = parseProjectDate(formatted)!;
    expect(parsed.getFullYear()).toBe(original.getFullYear());
    expect(parsed.getMonth()).toBe(original.getMonth());
    expect(parsed.getDate()).toBe(original.getDate());
    expect(parsed.getHours()).toBe(original.getHours());
    expect(parsed.getMinutes()).toBe(original.getMinutes());
    expect(parsed.getSeconds()).toBe(original.getSeconds());
  });
});
