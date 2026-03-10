# mpp-next

TypeScript library for reading Microsoft Project files (`.mpp` binary and `.mspdi` XML). Extracts tasks, resources, assignments, calendars, and relations into a structured `ProjectFile` object.

## Install

```bash
bun install
```

## Usage

```ts
import { readMpp, readMspdi, readJson, writeMspdi, writeJson } from "mpp-next";

// Read a binary MPP file (MPP14+ / Microsoft Project 2010+)
const project = await readMpp("schedule.mpp");

// Read MSPDI XML
const project2 = readMspdi(xmlString);

// Read/write JSON
const project3 = readJson(jsonString);
const json = writeJson(project);
const compact = writeJson(project, { pretty: false });

// Write MSPDI XML
const xml = writeMspdi(project);
```

### Validation with Zod

Validate untrusted data with the schema subpath (requires `zod` peer dependency):

```ts
import { ProjectFileSchema, TaskSchema } from "mpp-next/schema";

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
  loadMppContainer,
  detectMppVariant,
} from "mpp-next/advanced";

const reader = new MppReader();

// Inspect without full parse
const inspection = await reader.inspect("schedule.mpp");

// Load and read from a container directly
const container = await loadMppContainer("schedule.mpp");
const project = reader.readContainer(container);
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

Older MPP versions (8, 9, 12) are detected and produce a clear error message explaining that only MPP14+ is supported.

### Subpath exports

| Path                | Contents                                             |
| ------------------- | ---------------------------------------------------- |
| `mpp-next`          | Convenience functions (`readMpp`, `writeJson`, etc.) |
| `mpp-next/advanced` | Reader/writer classes, container utilities           |
| `mpp-next/schema`   | Zod validation schemas for all model types           |

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
