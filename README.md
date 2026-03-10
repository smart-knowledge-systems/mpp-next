# mpp-next

## Setup

```bash
bun install
```

## Development

```bash
bun run index.ts
```

## Scripts

| Script | Description |
| --- | --- |
| `bun run typecheck` | Type-check with `tsc --noEmit` (incremental, cached) |
| `bun run lint` | Lint with ESLint |
| `bun run lint:fix` | Lint and auto-fix |
| `bun run format` | Format with Prettier |
| `bun run format:check` | Check formatting |
| `bun run check` | Run all checks (typecheck + lint + format) |

## Tooling

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript (strict mode)
- **Linter**: ESLint with `@typescript-eslint`
- **Formatter**: Prettier

All tool caches (tsc, ESLint, Prettier) write to `node_modules/.cache/`.
