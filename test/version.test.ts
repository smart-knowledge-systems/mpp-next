import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import CFB from "cfb";

import { MppReader, loadMppContainer } from "../src/mpp/MppReader.ts";
import { detectMppVariant } from "../src/mpp/MppVariant.ts";
import type { MppContainer } from "../src/mpp/Mpp14Reader.ts";

const FIXTURE_MPP_PATH = resolveFixturePath("./sample-schedule.mpp");

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

describe("error handling: file access", () => {
  test("loading a non-existent file gives a clear error", async () => {
    const reader = new MppReader();
    await expect(reader.read("/tmp/does-not-exist-abc123.mpp")).rejects.toThrow(
      "MPP file not found",
    );
  });

  test("inspecting a non-existent file gives a clear error", async () => {
    const reader = new MppReader();
    await expect(reader.inspect("/tmp/does-not-exist-abc123.mpp")).rejects.toThrow(
      "MPP file not found",
    );
  });
});

describe("error handling: invalid files", () => {
  test("empty buffer gives a clear error about invalid file", async () => {
    const emptyPath = "/tmp/mpp-test-empty.mpp";
    await Bun.write(emptyPath, new Uint8Array(0));

    const reader = new MppReader();
    await expect(reader.read(emptyPath)).rejects.toThrow("The file is empty");
  });

  test("random bytes (not OLE2) give a clear error about invalid format", async () => {
    const garbagePath = "/tmp/mpp-test-garbage.mpp";
    const garbage = new Uint8Array(512);
    for (let i = 0; i < garbage.length; i++) {
      garbage[i] = i % 256;
    }
    await Bun.write(garbagePath, garbage);

    const reader = new MppReader();
    await expect(reader.read(garbagePath)).rejects.toThrow("not a valid OLE2/MPP document");
  });

  test("OLE2 container with no streams gives a clear error about unsupported format", async () => {
    // Create a minimal valid OLE2 file with cfb but no MPP-relevant streams
    const wb = CFB.utils.cfb_new();
    // Add a dummy stream that won't match any MPP pattern
    CFB.utils.cfb_add(wb, "/DummyStream", new Uint8Array([1, 2, 3]));
    const buf: number[] = CFB.write(wb, { type: "array" });
    const ole2Path = "/tmp/mpp-test-ole2-empty.mpp";
    await Bun.write(ole2Path, new Uint8Array(buf));

    const container = await loadMppContainer(ole2Path);
    expect(() => detectMppVariant(container)).toThrow("no TBknd table streams found");
  });
});

describe("error handling: old MPP versions", () => {
  test("detects version < 14 and throws a clear error with version number", () => {
    // Create a synthetic container that mimics an old-style MPP with version 9
    // by creating TBknd streams under a root that implies version 9
    const streams = new Map<string, Uint8Array>();
    const dummyData = new Uint8Array(64);

    // Root path "Root Entry/   109" implies version 9 (109 - 100 = 9)
    const tables = ["TBkndTask", "TBkndRsc", "TBkndAssn", "TBkndCal", "TBkndCons"];
    for (const table of tables) {
      streams.set(`Root Entry/   109/${table}/FixedData`, dummyData);
    }

    const container: MppContainer = { streams };
    expect(() => detectMppVariant(container)).toThrow(
      "Unsupported MPP file version: detected version 9",
    );
  });

  test("version error message mentions MPP14 and Microsoft Project 2010+", () => {
    const streams = new Map<string, Uint8Array>();
    const dummyData = new Uint8Array(64);

    const tables = ["TBkndTask", "TBkndRsc", "TBkndAssn", "TBkndCal", "TBkndCons"];
    for (const table of tables) {
      streams.set(`Root Entry/   112/${table}/FixedData`, dummyData);
    }

    const container: MppContainer = { streams };
    expect(() => detectMppVariant(container)).toThrow(
      "Only MPP14 and later (Microsoft Project 2010+) are supported",
    );
  });

  test("no TBknd streams error mentions older formats (MPP8, MPP9, MPP12)", () => {
    const streams = new Map<string, Uint8Array>();
    // Only add streams with non-TBknd paths
    streams.set("Root Entry/SomeOldStream", new Uint8Array(16));
    streams.set("Root Entry/AnotherOldStream", new Uint8Array(16));

    const container: MppContainer = { streams };
    expect(() => detectMppVariant(container)).toThrow("MPP8, MPP9, or MPP12");
  });
});

describe("sanity: valid MPP14 file", () => {
  test("a valid MPP14 file still loads successfully", async () => {
    const reader = new MppReader();
    const project = await reader.read(FIXTURE_MPP_PATH, {
      allowDefaultFixture: false,
    });

    expect(project.tasks.length).toBeGreaterThan(0);
    expect(project.resources.length).toBeGreaterThan(0);
  });

  test("a valid MPP14 file inspects successfully", async () => {
    const reader = new MppReader();
    const inspection = await reader.inspect(FIXTURE_MPP_PATH);

    expect(inspection.version).toBe(14);
    expect(inspection.family).toBe("modern");
  });
});
