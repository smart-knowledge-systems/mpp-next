# Changelog

## [Unreleased]

### Bug Fixes

- **`parseProjectDate` NaN guard** — Previously returned an `Invalid Date` object for unparseable strings; now correctly returns `null`.
- **`normalizeResourceId` unsigned sentinel** — Added `0xFFFF` (65535) as a sentinel value, fixing incorrect resource ID resolution in MPP14 files.
- **DST-safe timestamp arithmetic** — `getTimestampValue` now uses UTC-based math to avoid DST-skipped-hour distortion.
- **Duplicate `readProps` call** — Replaced with a lazy `props14` getter in `Mpp14Reader`.

### Improvements

- **CSV injection protection** — `escapeField` now prefixes fields starting with `=`, `+`, `-`, `@`, tab, or carriage return with an apostrophe to prevent formula injection in spreadsheet applications.
- **O(1) offset lookup in `FixedData`** — Replaced linear `indexOf` with a `Map`-based lookup.
- **Lazy `utf16Preview`** — Deferred `extractUtf16Strings` call from construction to first access.
- **Zod schema unification** — Schemas are now the single source of truth for model types via `z.infer`.

### Removed

- Dead code: `trimNumber` helper, `FieldMap.ts`, unused methods in `Var2Data`/`VarMeta`/`FixedData`.
- `formatDate` wrapper in `MspdiWriter` (replaced by direct `formatProjectDate` calls).
