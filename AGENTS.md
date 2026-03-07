# Karya — Agent Instructions

SQL-backed task tracker for orchestrating AI agents across machines.

## Commands

```bash
# Install
bun install

# Run CLI (Bun)
bun run dev -- <command>

# Run CLI (Node fallback)
bun run dev:node -- <command>

# Build
bun run build          # tsc -> dist/

# Test
bun run test           # vitest unit + integration tests
bun run test:e2e       # CLI e2e tests

# Lint (type-check only)
bun run lint           # tsc --noEmit

# Launcher (auto-detects Bun or Node)
./bin/karya <command>
```

## Architecture

**Stack:** TypeScript (ES2022, NodeNext modules), Bun, Commander.js, Zod,
better-sqlite3, optional `pg`, Vitest

### Source layout

```text
src/
  core/
    backend.ts         # DbBackend interface + task buckets
    backends/
      sqlite.ts        # better-sqlite3 backend
      pg.ts            # PostgreSQL backend + TLS options
    create-backend.ts  # Backend factory
    schema.ts          # Zod schemas (Task, config, filters)
    task-store.ts      # Domain operations + reconcile-on-write
    config.ts          # Config load/save/resolution + env parsing
    query.ts           # Filter + sort tasks
    reconcile.ts       # Field-level merge for write conflicts
    migrate.ts         # JSON import migration helpers
    dates.ts           # ISO timestamps + relative due parsing
    errors.ts          # KaryaError with typed error codes
    id.ts              # 8-char nanoid generation
  cli/
    index.ts           # Commander entrypoint + global options
    commands/          # add/list/show/edit/transition/archive/etc.
    formatters/        # Human + JSON output formatting
    shared/runtime.ts  # Resolve config + create backend/store per command
  shared/
    constants.ts       # Defaults (schema/project/priority/backend)
    types.ts           # Output warning/result helper types
tests/
  core/                # Unit tests for core modules
  cli/                 # CLI command registration tests
  e2e/                 # CLI end-to-end tests
```

### Data model

Tasks are stored in SQL (SQLite or PostgreSQL) in a single `tasks` table.
Rows are partitioned by `bucket` (`tasks` or `archive`) and contain serialized
task payloads with timestamps for optimistic writes.

### Config resolution order

CLI flags > env vars > app config (`~/.config/karya/karya.json`) > defaults.

Relevant env vars:
- `KARYA_BACKEND`
- `KARYA_DB_PATH`
- `KARYA_DATA_DIR` (legacy alias)
- `KARYA_PG_CONNECTION_STRING`
- `KARYA_PG_SSL` (`verify-full` or `off`)
- `KARYA_PG_SSL_CA`
- `KARYA_AUTHOR`
- `KARYA_FORMAT`
- `KARYA_SKIP_LEGACY_CHECK`

### PostgreSQL TLS

- Default mode: `verify-full`
- Optional dev mode: `off`
- Invalid `KARYA_PG_SSL` values are a hard config error
- Optional CA path supports `~/...` expansion via `backend.sslCaPath` /
  `KARYA_PG_SSL_CA`


## Patterns

- Zod schemas in `src/core/schema.ts` are the type source of truth
- Partial ID matching requires at least 4 characters
- Terminal states (`done`, `cancelled`) move tasks to `archive` bucket
- Writes are optimistic (`putTask` checks `updated_at`); conflicts reconcile in
  `TaskStore.writeTask`
- App config writes attempt POSIX `0600` permissions (best-effort)

## Gotchas

- All imports use `.js` extensions (NodeNext)
- `bun run test` uses Vitest (not Bun's built-in test runner)
- `--data-dir` maps to `<path>/karya.db` for legacy compatibility
- `parseDueInput` returns `null` for invalid dates and callers must validate
- `KaryaError` codes: `VALIDATION`, `NOT_FOUND`, `INVALID_ID`,
  `AMBIGUOUS_ID`, `INVALID_STATE`, `WRITE_CONFLICT`, `CONFIG`, `USAGE`
