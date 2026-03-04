# Karya — Agent Instructions

Git-backed task tracker for orchestrating AI agents across machines.

## Commands

```bash
# Install
bun install

# Run CLI (Bun)
bun run dev -- <command>

# Run CLI (Node fallback)
npm run dev:node -- <command>

# Build
bun run build          # tsc -> dist/

# Test
bun run test           # vitest unit tests
bun run test:e2e       # e2e tests (CLI + web)

# Lint (type-check only)
bun run lint           # tsc --noEmit

# Launcher (auto-detects Bun or Node)
./bin/karya <command>
```

## Architecture

**Stack:** TypeScript (ES2022, NodeNext modules), Bun, Commander.js, Hono,
Zod, Vitest

### Source layout

```
src/
  core/           # Domain logic (no CLI/web dependencies)
    schema.ts     # Zod schemas: Task, RepoConfig, AppConfig, ListFilters
    task-store.ts # File-based CRUD, archive semantics, reconcile-on-write
    git-sync.ts   # Git operations: pull/rebase, commit, push with retries
    config.ts     # Config resolution: CLI flags > env > app config > repo config
    query.ts      # Filter + sort tasks
    reconcile.ts  # Field-level merge (last-write-wins scalars, append-merge notes)
    migrate.ts    # Schema migration for task/config records
    dates.ts      # ISO timestamps, relative date parsing
    errors.ts     # KaryaError with typed error codes
    id.ts         # 8-char nanoid generation
    fs.ts         # Atomic JSON writes, ensureDir
  cli/
    index.ts      # Entry point: Commander program setup
    commands/     # One file per command (add, list, show, edit, etc.)
    formatters/   # Human and JSON output formatting
    shared/       # CliRuntime: resolves config + creates store/sync per command
  web/
    server.ts     # Hono app: HTML+HTMX routes + JSON API
  shared/
    types.ts      # Shared TS types (WriteResult)
    constants.ts  # Default values (schema version, project, priority, port)
tests/
  core/           # Unit tests mirroring src/core/
  e2e/            # CLI and web server integration tests
```

### Data model

Each task is a single JSON file (`tasks/<id>.json` or `archive/<id>.json`).
IDs are 8-character nanoids. Terminal states (`done`, `cancelled`) move files to
`archive/`. Schema version is tracked per record for future migrations.

```
<data-repo>/
  config.json          # Repo-level defaults
  tasks/<id>.json      # Active tasks
  archive/<id>.json    # Completed/cancelled tasks
  projects/<slug>.json # Project metadata
```

### Config resolution order

CLI flags > env vars (`KARYA_DATA_DIR`, `KARYA_AUTHOR`, `KARYA_NO_SYNC`,
`KARYA_FORMAT`) > app config (`~/.config/karya/karya.json`) > repo config
(`<data-dir>/config.json`) > hardcoded defaults.

### Git sync strategy

- **Reads:** Always local, never require network
- **Writes:** Lock locally > pull/rebase > write files > commit > push (with
  retry on non-fast-forward)
- **Conflicts:** Last-write-wins for scalar fields by `updatedAt`; notes are
  append-merged and deduplicated
- **Offline:** Commits locally, queues push; `--no-sync` disables auto-sync

### Web UI

Hono server with string-template HTML + HTMX for partial updates. PicoCSS
for styling. Exposes both HTML routes (`/`, `/tasks`, `/tasks/:id`) and a
JSON API (`/api/tasks`, `/api/tasks/:id`).

## Patterns

- **One file per task:** Minimizes git merge conflicts when multiple agents
  write concurrently
- **Zod schemas as source of truth:** All types are inferred from Zod schemas
  in `schema.ts`
- **Idempotent transitions:** Status transitions are no-ops if already in
  target state (no error thrown)
- **Partial ID matching:** Commands accept ID prefixes (min 4 chars) and throw
  `AMBIGUOUS_ID` if non-unique
- **Atomic writes:** `writeJsonAtomic` in `fs.ts` for crash-safe file updates
- **Reconcile on write:** `TaskStore.writeTask` checks for existing file and
  reconciles if needed

## Gotchas

- All imports use `.js` extensions (NodeNext module resolution)
- `bun run test` uses Vitest, not Bun's built-in test runner
- The `--no-sync` flag is the Commander negated form of `--sync` (boolean)
- `parseDueInput` returns `null` for invalid dates (caller must check)
- `KaryaError` codes: `VALIDATION`, `NOT_FOUND`, `INVALID_ID`, `AMBIGUOUS_ID`,
  `INVALID_STATE`, `SYNC`
- Web server uses `@hono/node-server` (not Bun.serve) for Node compatibility
