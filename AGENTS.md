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
    backend.ts         # DbBackend interface + users/tasks/relations repositories
    backends/
      sqlite.ts        # better-sqlite3 backend
      pg.ts            # PostgreSQL backend + TLS options
    create-backend.ts  # Backend factory
    schema.ts          # Zod schemas (User, Task, config, filters)
    task-store.ts      # Task operations + relation management
    user-store.ts      # User CRUD + active-user resolution
    config.ts          # Config load/save/resolution + env parsing
    query.ts           # Filter + sort tasks
    dates.ts           # ISO timestamps
    errors.ts          # KaryaError with typed error codes
    id.ts              # 8-char nanoid generation
  cli/
    index.ts           # Commander entrypoint + global options
    commands/          # setup/users/add/list/show/edit/delete/etc.
    formatters/        # Human + JSON output formatting
    shared/runtime.ts  # Resolve config + create backend/stores per command
  shared/
    constants.ts       # Defaults (schema/project/priority/backend)
    types.ts           # Output warning/result helper types
tests/
  core/                # Unit tests for core modules
  cli/                 # CLI command registration tests
  e2e/                 # CLI end-to-end tests
```

### Data model

Karya uses normalized SQL tables: `users`, `tasks`, and `task_relations`.
Tasks stay in the main table regardless of terminal state; `closedAt` indicates
whether a task is closed. `tasks.note` stores a single optional inline string
or URI.

### Config resolution order

CLI flags > env vars > app config (`~/.config/karya/karya.json`) > defaults.

Relevant env vars:
- `KARYA_BACKEND`
- `KARYA_DB_PATH`
- `KARYA_PG_CONNECTION_STRING`
- `KARYA_PG_SSL` (`verify-full` or `off`)
- `KARYA_PG_SSL_CA`
- `KARYA_AUTHOR`
- `KARYA_FORMAT`

### PostgreSQL TLS

- Default mode: `verify-full`
- Optional dev mode: `off`
- Invalid `KARYA_PG_SSL` values are a hard config error
- Optional CA path supports `~/...` expansion via `backend.sslCaPath` /
  `KARYA_PG_SSL_CA`

## Patterns

- Zod schemas in `src/core/schema.ts` are the type source of truth
- Partial ID matching requires at least 4 characters
- Task writes are last-write-wins; there is no optimistic conflict detection
- Backend initialization enforces schema version via `karya_meta`
- App config writes attempt POSIX `0600` permissions (best-effort)

## Gotchas

- All imports use `.js` extensions (NodeNext)
- `bun run test` uses Vitest (not Bun's built-in test runner)
- `KaryaError` codes: `VALIDATION`, `NOT_FOUND`, `INVALID_ID`,
  `AMBIGUOUS_ID`, `INVALID_STATE`, `CONFIG`, `SCHEMA_MISMATCH`, `USAGE`
- `pg` is an optional peer dependency — not present in Homebrew/global
  installs. Dynamic imports of optional deps must be wrapped in try-catch
  with a helpful `KaryaError` (see `create-backend.ts`)
