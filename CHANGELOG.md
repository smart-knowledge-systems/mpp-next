# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Resource-leveling engine (`levelset/leveling` subpath).** A composable
  scheduling toolkit that operates on any `ProjectFile` and pulls only `zod` —
  none of the file-I/O dependencies. The pipeline is
  `resolveCalendar` → `serialSGS` → `ScheduleStream` → `materialize`:
  - `resolveCalendar` — turns calendars into day-indexed working time
    (`Uint8Array` bitmap + prefix sum) for O(1) working-day arithmetic.
  - `serialSGS` — a greedy serial Schedule Generation Scheme that topo-sorts by
    precedence and places each task on the earliest feasible day, yielding one
    feasible `Schedule` per run.
  - `ScheduleStream` — a lazy iterable of feasible schedules with
    `filter` / `map` / `take` / `branch` and the `bestBy` / `paretoFrontier` /
    `collect` materializers.
  - `materialize` — writes a chosen `Schedule` back into a `ProjectFile`.
  - `weeklyProfile` — weekly resource-demand binning for profile analysis.
- **`Constraint` ADT and `Scorer` interface.** A discriminated union that is the
  interchange format between blocks and the search. `serialSGS` enforces
  `Precedence`, `MaxConcurrentResource`, `PeakCap`, `ConcurrentUnitsLimit`, and
  `Release` / `Deadline`; `UnitPrecedence`, `UnimodalProfile`, `ModeSelection`,
  and `CrewFlowContinuity` are recorded as schedule annotations for a future
  CP-SAT / MiniZinc backend.
- **`WorkUnit` model with hard WIP limits.** `ConcurrentUnitsLimit` caps how many
  work units are open at once (optionally scoped per-discipline) to prioritize
  completion; it subsumes the former `LaydownSpaceCap`.
- **Scoring and constraint blocks (`level-blocks`).** Each block builds a
  configured `Constraint` or `Scorer` and emits a MiniZinc fragment for the
  compiled backend: `MaxConcurrentResourceBlock`, `ConcurrentResourceCostBlock`,
  `ConcurrentUnitsLimitBlock`, `HiringLagPenaltyBlock`, `OpenUnitPenaltyBlock`,
  and `UnimodalDeviationBlock`.
- **XLSX Gantt output.** `XlsxWriter.writeWithGantt` embeds a stacked-bar Gantt
  chart in the generated workbook.

### Changed

- `MaxConcurrentResource` placement semantics aligned with the MiniZinc model.
- Bumped TypeScript to 6.0.3 and tightened `tsconfig`.
- Zod schemas are now the single source of truth for model types via `z.infer`.
- **O(1) offset lookup in `FixedData`** — replaced linear `indexOf` with a
  `Map`-based lookup.
- **Lazy `utf16Preview`** — deferred the `extractUtf16Strings` call from
  construction to first access.

### Fixed

- **FF/SF precedence approximation** — `serialSGS` now emits an annotation when a
  finish-to-finish / start-to-finish edge is approximated, with a tightened
  lower bound.
- **`advanceWorkingDays` guards** — guarded in the placement loop and in
  lagged-edge `earliestStart` computation.
- **`parseProjectDate` NaN guard** — previously returned an `Invalid Date` object
  for unparseable strings; now correctly returns `null`.
- **`normalizeResourceId` unsigned sentinel** — added `0xFFFF` (65535) as a
  sentinel value, fixing incorrect resource ID resolution in MPP14 files.
- **DST-safe timestamp arithmetic** — `getTimestampValue` now uses UTC-based math
  to avoid DST-skipped-hour distortion.
- **Duplicate `readProps` call** — replaced with a lazy `props14` getter in
  `Mpp14Reader`.

### Security

- **CSV injection protection** — `escapeField` prefixes fields starting with `=`,
  `+`, `-`, `@`, tab, or carriage return with an apostrophe, and quotes bare
  carriage returns, to prevent formula injection in spreadsheet applications.

### Removed

- Dead code: `trimNumber` helper, `FieldMap.ts`, unused methods in
  `Var2Data` / `VarMeta` / `FixedData`.
- `formatDate` wrapper in `MspdiWriter` (replaced by direct `formatProjectDate`
  calls).
