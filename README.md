# levelset

A TypeScript **resource-leveling and project-scheduling toolkit**. You author constraints and scorers as composable blocks, run a schedule-generation search, and materialize a re-leveled schedule. The leveling layer (`level-core` + `level-blocks`) is the heart of the library and operates on any `ProjectFile`, wherever it came from.

To get real project data in and out, levelset also bundles readers and writers for common formats — Microsoft Project (`.mpp` binary, `.mspdi` XML), plus JSON, CSV, and XLSX — so you can level an existing plan and write the result back. The reader extracts tasks, resources, assignments, calendars, and relations into a structured `ProjectFile`.

Jump to **[Resource leveling](#resource-leveling)** for the scheduling toolkit, or read on for the file I/O.

## Install

```bash
bun install
```

## Usage

```ts
import { readMpp, readMspdi, readJson, writeMspdi, writeJson, writeCsv, writeXlsx } from "levelset";

// Read a binary MPP buffer (MPP14+ / Microsoft Project 2010+)
// Accepts Uint8Array or ArrayBuffer — no filesystem access required
const mppBytes = await file.arrayBuffer(); // e.g. from a client upload
const project = readMpp(mppBytes);

// Read MSPDI XML
const project2 = readMspdi(xmlString);

// Read/write JSON
const project3 = readJson(jsonString);
const json = writeJson(project);
const compact = writeJson(project, { pretty: false });

// Write MSPDI XML
const xml = writeMspdi(project);

// Write CSV (leaf tasks by default, with resource names from assignments)
const csv = writeCsv(project);
const csvAll = writeCsv(project, { includeSummaryTasks: true, includeResources: false });

// Write Excel (returns a Uint8Array)
const xlsx = await writeXlsx(project);
await Bun.write("schedule.xlsx", xlsx);
const xlsxCustom = await writeXlsx(project, { sheetName: "Tasks" });
```

### Validation with Zod

Validate untrusted data with the schema subpath (requires `zod` peer dependency):

```ts
import { ProjectFileSchema, TaskSchema } from "levelset/schema";

// Validate unknown JSON from an API or file
const result = ProjectFileSchema.safeParse(untrustedData);
if (result.success) {
  const project = result.data; // fully typed ProjectFile
  // Duration fields are real Duration instances, dates are Date objects
}

// Validate individual entities
const taskResult = TaskSchema.safeParse(someTaskData);
```

All schemas include transforms — `{ duration: 8, units: "hours" }` objects become `Duration` class instances, date strings become `Date` objects.

### Advanced API

For lower-level access (container inspection, variant detection):

```ts
import {
  MppReader,
  MspdiReader,
  MspdiWriter,
  JsonReader,
  JsonWriter,
  CsvWriter,
  XlsxWriter,
  parseMppBuffer,
  detectMppVariant,
} from "levelset/advanced";

const reader = new MppReader();

// Read from a buffer (Uint8Array or ArrayBuffer)
const project = reader.read(mppBytes);

// Inspect without full parse
const inspection = reader.inspect(mppBytes);

// Parse buffer into a container and work with it directly
const container = parseMppBuffer(mppBytes);
const project2 = reader.readContainer(container);
```

### What it extracts

- **Tasks** — name, dates, duration, % complete, WBS, summary/subtask hierarchy, critical path, scheduling analysis (free/total slack, early/late start/finish, leveling delay, deadline)
- **Resources** — people, equipment, or cost items, resource pool
- **Assignments** — resource-to-task allocations with units, actual work, remaining work
- **Calendars** — working hours, week days, exceptions/holidays
- **Relations** — task dependencies (FS, FF, SS, SF) with lag
- **Properties** — title, author, start/finish dates, scheduling defaults

### Supported formats

| Format                               | Read | Write |
| ------------------------------------ | ---- | ----- |
| MPP (binary, MPP14+ / Project 2010+) | Yes  | No    |
| MSPDI (XML)                          | Yes  | Yes   |
| JSON                                 | Yes  | Yes   |
| CSV                                  | No   | Yes   |
| XLSX (Excel)                         | No   | Yes   |

Older MPP versions (8, 9, 12) are detected and produce a clear error message explaining that only MPP14+ is supported.

### Subpath exports

| Path                | Contents                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| `levelset`          | Convenience functions (`readMpp`, `writeJson`, `writeCsv`, `writeXlsx`, etc.) |
| `levelset/leveling` | Resource-leveling toolkit (`level-core` + `level-blocks`) — no file-I/O deps  |
| `levelset/advanced` | Reader/writer classes, container utilities                                    |
| `levelset/schema`   | Zod validation schemas for all model types                                    |

## Resource leveling

> **Experimental.** The leveling layer is published under the `levelset/leveling` subpath, but its API is still evolving and may change between minor versions before `1.0`. Importing it pulls only `zod` (a peer dependency) — none of the file-I/O dependencies (`exceljs`, `cfb`, `fast-xml-parser`), so the scheduler stays out of your bundle if you don't use the readers/writers.

The engine's design is grounded in published research across constraint programming, project scheduling, solution diversity, hyper-heuristics, and LLM-assisted optimization modeling — see the [literature review](docs/literature-review.md) for the sources and how each one shapes the architecture.

### Pipeline

The leveling flow is a sequence of small, composable steps:

```
ProjectFile ──resolveCalendar──▶ ResolvedProject ──serialSGS.run(constraints)──▶
  ScheduleStream ──bestBy(scorer)──▶ Schedule ──materialize──▶ ProjectFile
```

- **`resolveCalendar`** turns calendars into day-indexed working time (a bitmap + prefix sum) so "working days between A and B" is O(1).
- **`serialSGS`** is a greedy serial Schedule Generation Scheme: topo-sort by precedence, then place each task on the earliest day that satisfies every constraint. One feasible schedule per run.
- **`ScheduleStream`** is a lazy iterable of feasible schedules with `filter` / `map` / `take` / `branch` and the materializers `bestBy` / `paretoFrontier` / `collect`.
- **`materialize`** writes a chosen `Schedule` back into a `ProjectFile` (round-tripping dates), ready for `writeMspdi` / `writeXlsx` / etc.

```ts
import { resolveCalendar, serialSGS, streamFromFactory, materialize } from "levelset/leveling";
import type { Constraint, Scorer } from "levelset/leveling";

// 1. Resolve calendars → day-indexed working time
const resolved = resolveCalendar(project);

// 2. Author constraints (the interchange ADT between blocks and the search)
const constraints: Constraint[] = [
  { kind: "MaxConcurrentResource", resourceUniqueId: 100, max: 3 },
  {
    kind: "ConcurrentUnitsLimit",
    discipline: 200, // a resourceUniqueId; omit for a whole-unit cap
    max: 2,
    units: [
      { id: 10, location: "Zone A", taskUniqueIds: [1, 2, 3] },
      { id: 20, location: "Zone B", taskUniqueIds: [4, 5, 6] },
    ],
  },
];

// 3. Search → lazy stream of feasible schedules
const stream = streamFromFactory(() => serialSGS.run(resolved, constraints));

// 4. Pick the best by a scorer
const makespan: Scorer = { name: "makespan", direction: "min", score: (s) => s.makespan };
const best = await stream.bestBy(makespan);

// 5. Materialize back to a ProjectFile (then write it out however you like)
if (best) {
  const leveled = materialize(best);
}
```

### Work units

A **`WorkUnit`** is the largest independent work package — the minimum complete increment that can be handed over (a building floor, a workcell, a release milestone — whatever the smallest shippable package is in your domain). It carries optional `location` (where), `productType` + `serial` (the serial-numbered instance of a generic product), and the `taskUniqueIds` that comprise it. Units are what the WIP-limiting constraints and scorers operate on.

### Constraints

Constraints are a discriminated union (`Constraint`) — the interchange format between blocks and the search. `serialSGS` enforces a subset directly; the rest are recorded as `unsupportedConstraints` annotations on the emitted schedule (intended for a future CP-SAT / MiniZinc backend).

| `kind`                  | What it does                                                             | Enforced by `serialSGS` |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------- |
| `Precedence`            | FS / SS / FF / SF edges with lag (FF/SF are approximated)                | Yes                     |
| `MaxConcurrentResource` | ≤ N tasks may demand a resource on any day (crew/throughput cap)         | Yes                     |
| `PeakCap`               | Sum of fractional units on a resource ≤ cap (optionally windowed)        | Yes                     |
| `ConcurrentUnitsLimit`  | ≤ N units have active work on any day; optional `discipline` scope (WIP) | Yes                     |
| `Release` / `Deadline`  | Earliest start / latest finish bounds per task                           | Yes                     |
| `Calendars`             | Baked into `resolveCalendar` upstream                                    | n/a                     |
| `UnitPrecedence`        | A unit may not start until other units finish                            | No (annotation)         |
| `UnimodalProfile`       | One-ramp-up-one-ramp-down shape on a resource histogram                  | No (annotation)         |
| `ModeSelection`         | Multi-mode RCPSP — crew-size × duration trade-off per task               | No (annotation)         |
| `CrewFlowContinuity`    | Keep a crew flowing through a unit sequence without idle gaps            | No (annotation)         |

`ConcurrentUnitsLimit` is the hard WIP cap that prioritizes **completion**: cap how many units are open at once so the search finishes started units before opening more. Omit `discipline` for a whole-unit cap; set it to a `resourceUniqueId` for a per-discipline cap ("≤ 2 units in a given phase at once"). It subsumes the former `LaydownSpaceCap`.

### Scorers (scoring blocks)

A `Scorer` ranks a `Schedule` (`direction: "min" | "max"`); `stream.bestBy(scorer)` picks the best. Scoring **blocks** (`level-blocks`) build configured scorers and also emit a MiniZinc fragment for the compiled backend.

| Block                         | Prices…                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `ConcurrentResourceCostBlock` | Each marginal concurrent worker on an exponential curve (soft `MaxConcurrentResource`) |
| `OpenUnitPenaltyBlock`        | Each open-unit-day beyond a `softMax` — a soft WIP limit (soft `ConcurrentUnitsLimit`) |
| `HiringLagPenaltyBlock`       | Week-over-week headcount increases (training/ramp cost before productivity)            |
| `UnimodalDeviationBlock`      | How far a resource histogram departs from a single-peak shape                          |

```ts
import { OpenUnitPenaltyBlock } from "levelset/leveling";

// Soft WIP limit: leave 2 units open for free, then penalize each extra open-unit-day.
const wipPenalty = OpenUnitPenaltyBlock.apply({
  units: [
    { id: 10, taskUniqueIds: [1, 2, 3] },
    { id: 20, taskUniqueIds: [4, 5, 6] },
  ],
  softMax: 2,
  weight: 50,
});
const best = await stream.bestBy(wipPenalty);
```

> **Note:** `serialSGS` emits a single schedule, so a scorer currently _ranks_ output rather than _steering_ it — `bestBy` over a one-schedule stream returns that schedule. Scorers become an optimization lever once a multi-candidate search (restart / LDS / LNS transformer) consumes them. Hard constraints (the table above) are what shape `serialSGS` output today.

Constraint blocks pair with the hard variants — `MaxConcurrentResourceBlock` and `ConcurrentUnitsLimitBlock` build the corresponding `Constraint` and a MiniZinc fragment.

## Scripts

| Script                 | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `bun test`             | Run tests                                            |
| `bun run typecheck`    | Type-check with `tsc --noEmit` (incremental, cached) |
| `bun run lint`         | Lint with ESLint                                     |
| `bun run lint:fix`     | Lint and auto-fix                                    |
| `bun run format`       | Format with Prettier                                 |
| `bun run format:check` | Check formatting                                     |
| `bun run check`        | Run all checks (typecheck + lint + format)           |

## Tooling

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript (strict mode)
- **Linter**: ESLint with `@typescript-eslint`
- **Formatter**: Prettier
- **Validation**: [Zod](https://zod.dev) (optional peer dependency)

All tool caches (tsc, ESLint, Prettier) write to `node_modules/.cache/`.
