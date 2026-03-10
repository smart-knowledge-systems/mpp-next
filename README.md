# mpp-next

TypeScript library for reading Microsoft Project files (`.mpp` binary and `.mspdi` XML). Extracts tasks, resources, assignments, calendars, and relations into a structured `ProjectFile` object.

## Install

```bash
bun install
```

## Usage

```ts
import { readMpp, readMspdi, writeMspdi } from "mpp-next";

// Read a binary MPP file
const project = await readMpp("schedule.mpp");

// Read MSPDI XML
const project2 = readMspdi(xmlString);

// Write MSPDI XML
const xml = writeMspdi(project);
```

### Advanced API

For lower-level access (container inspection, variant detection):

```ts
import { MppReader, loadMppContainer, detectMppVariant } from "mpp-next/advanced";

const reader = new MppReader();

// Inspect without full parse
const inspection = await reader.inspect("schedule.mpp");

// Load and read from a container directly
const container = await loadMppContainer("schedule.mpp");
const project = reader.readContainer(container);
```

### What it extracts

- **Tasks** — name, dates, duration, % complete, WBS, summary/subtask hierarchy, critical path
- **Resources** — people, equipment, or cost items
- **Assignments** — resource-to-task allocations with units
- **Calendars** — working hours, week days, exceptions/holidays
- **Relations** — task dependencies (FS, FF, SS, SF) with lag
- **Properties** — title, author, start/finish dates, scheduling defaults

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

All tool caches (tsc, ESLint, Prettier) write to `node_modules/.cache/`.
