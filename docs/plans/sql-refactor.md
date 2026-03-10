# SQL-Everywhere Backend + npm Package

## Context

Karya currently stores tasks as one-JSON-file-per-task in a local directory,
synced via git. The `data/` directory lives in the tool's own repo. The goal:

1. **SQL everywhere** — SQLite for local, PostgreSQL for remote (beta).
   Shared `DbBackend` interface; each backend has its own SQL queries in
   its native dialect (no query sharing or placeholder rewriting).
2. **Remove `data/`** from this repo
3. **Publishable npm package**
4. **JSON export utility** for portability/git compatibility

The git-sync mechanism is removed. SQLite handles concurrency locally;
PostgreSQL handles it remotely. A `karya export` command dumps tasks to JSON
files for interop.

**This is a breaking change.** Existing users' JSON file data is NOT
auto-migrated. On first run, if a legacy `tasks/` directory is detected at the
old `dataDir`, the CLI prints a blocking warning with exact import instructions
before proceeding.

## Breaking Changes

- **Data format**: Tasks stored in SQLite (or PostgreSQL), not JSON files
- **No auto-migration**: Users must run `karya import --input <old-data-dir>`
  to migrate existing tasks
- **Config format**: `dataDir` in app config replaced by `backend` object
  (auto-migrated on config load)
- **Removed commands**: `karya sync` removed (no git sync)
- **Removed flags**: `--no-sync` removed
- **Changed flags**: `--data-dir` replaced by `--db-path` (legacy flag still
  accepted, interpreted as SQLite path `<dir>/karya.db`)
- **New flags**: `--skip-legacy-check` (global) to bypass legacy data warning

## Consistency Contract

### Optimistic Concurrency

All writes use conditional upserts that check `updated_at`. The logical
pattern (shown here in SQLite syntax — PostgreSQL uses `$1`-style params):

```sql
-- SQLite example (PgBackend has equivalent with $1, $2, ...)
INSERT INTO tasks (id, bucket, data, updated_at, created_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  bucket = excluded.bucket,
  data = excluded.data,
  updated_at = excluded.updated_at
WHERE tasks.updated_at <= excluded.updated_at;
```

If the `WHERE` clause rejects the update (remote is newer), the upsert
affects 0 rows. The backend detects this via `changes()` (SQLite) or
`rowCount` (pg) and returns a conflict signal. `TaskStore.writeTask()` then
fetches the current row and runs `reconcileTasks()` (existing logic:
last-write-wins per scalar field, append-merge for notes), then retries the
upsert with the merged result.

### Error Codes

Existing `KaryaError` codes unchanged. New internal signal:

- `WRITE_CONFLICT` — returned by backend when conditional upsert fails.
  TaskStore handles this internally; callers never see it.

## Backend Capability Matrix

| Capability | SQLite (v1) | PostgreSQL (beta) |
|------------|-------------|-------------------|
| Local storage | Yes | No (remote only) |
| Multi-machine | No | Yes |
| Concurrent local writes | Yes (WAL mode) | N/A |
| Concurrent remote writes | N/A | Yes (conditional upsert) |
| Export/import | Yes | Yes |
| `config init` | Creates DB file | Creates table |

## Architecture

```
                 ┌──────────┐
                 │TaskStore  │  domain logic (validation, prefix matching,
                 │           │  state transitions, reconciliation)
                 └─────┬─────┘
                       │ uses
                 ┌─────▼─────┐
                 │ DbBackend  │  interface: getTask, putTask, listTasks, etc.
                 └─────┬─────┘
              ┌────────┴────────┐
        ┌─────▼──────┐   ┌─────▼─────┐
        │SqliteBackend│   │  PgBackend │
        │(better-     │   │  (pg)      │
        │ sqlite3)    │   │ [beta]     │
        └─────────────┘   └────────────┘
```

Each backend maintains its own SQL queries (no shared query strings, no
placeholder rewriting). Both implement the same `DbBackend` interface.

## SQL Schema

Same logical schema, expressed in each backend's native dialect:

**SQLite:**
```sql
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  bucket     TEXT NOT NULL DEFAULT 'tasks'
             CHECK (bucket IN ('tasks', 'archive')),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_bucket_id ON tasks (bucket, id);
```

**PostgreSQL:**
```sql
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  bucket     TEXT NOT NULL DEFAULT 'tasks'
             CHECK (bucket IN ('tasks', 'archive')),
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_bucket_id
  ON tasks (bucket, id text_pattern_ops);
```

The `text_pattern_ops` operator class ensures PostgreSQL uses the index for
`LIKE 'prefix%'` queries regardless of locale settings. SQLite uses the
standard `(bucket, id)` index which inherently supports prefix matching.

Composite `(bucket, id)` index supports both bucket filtering and prefix
lookups (`WHERE bucket = ? AND id LIKE ?`) efficiently.

## Default DB Path (Platform-Specific)

```typescript
function defaultDbPath(): string {
  const platform = process.platform;
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "karya", "karya.db");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "karya", "karya.db");
  }
  // Linux / others: XDG_DATA_HOME
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "karya", "karya.db");
}
```

## Implementation Steps

### Step 1: Create `DbBackend` interface

**New file:** `src/core/backend.ts`

```typescript
export type Bucket = "tasks" | "archive";

export interface WriteResult {
  written: boolean;  // false if conditional upsert was rejected (conflict)
}

export interface DbBackend {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getTask(id: string, bucket: Bucket): Promise<Task | null>;
  getAllTasks(bucket: Bucket): Promise<Task[]>;
  findByPrefix(prefix: string, bucket: Bucket): Promise<Task[]>;
  putTask(task: Task, bucket: Bucket): Promise<WriteResult>;
  deleteTask(id: string, bucket: Bucket): Promise<void>;
  moveTask(task: Task, from: Bucket, to: Bucket): Promise<void>;
}
```

`putTask` returns `{ written: false }` when the conditional upsert is
rejected (existing row has newer `updated_at`). TaskStore uses this to
trigger reconciliation.

### Step 2: Implement `SqliteBackend`

**New file:** `src/core/backends/sqlite.ts`

Uses `better-sqlite3`. Each method has its own prepared statement with SQLite
syntax. Key aspects:

- `initialize()`: creates table + composite index
- `putTask()`: conditional upsert with `WHERE tasks.updated_at <= excluded.updated_at`,
  checks `this.db.prepare(...).run(...).changes` to detect conflicts
- `findByPrefix()`: `SELECT data FROM tasks WHERE bucket = ? AND id LIKE ?`
  using composite index
- WAL journal mode for concurrent reads

### Step 3: Implement `PgBackend`

**New file:** `src/core/backends/pg.ts`

Uses `pg` (node-postgres). Each method has its own query string with `$1`-style
placeholders (native pg syntax, no rewriting). Same logic as SQLite but:

- Uses `JSONB` for data column
- Uses `TIMESTAMPTZ` for timestamps
- Checks `result.rowCount` for conflict detection in `putTask()`
- `pg` is an optional peer dependency

### Step 4: Backend factory

**New file:** `src/core/create-backend.ts`

```typescript
export async function createBackend(config: BackendConfig): Promise<DbBackend>
```

Lazy imports so `better-sqlite3` and `pg` are only loaded when needed.
For `sqlite`: ensures parent directory exists before opening DB.

### Step 5: Update config/schema

**Modify:** `src/core/schema.ts`

- Add `BackendConfigSchema` (discriminated union: `sqlite` | `pg`)
- Update `AppConfigSchema`: replace `dataDir` with optional `backend` field
- Remove `RepoConfigSchema` — its useful fields (`defaultProject`,
  `defaultPriority`) are already in `AppConfigSchema`

**Modify:** `src/core/config.ts`

- `loadAppConfig()`: if old config has `dataDir` but no `backend`, auto-convert
  to `{ type: "sqlite", dbPath: "<dataDir>/karya.db" }`
- Remove `loadRepoConfig()`, `getRepoConfigPath()`, `initDataRepo()`
- Add `defaultDbPath()` with platform-specific paths
- New env vars: `KARYA_BACKEND=sqlite|pg`, `KARYA_DB_PATH`,
  `KARYA_PG_CONNECTION_STRING`
- `ResolvedConfig`: replace `dataDir`, `repoConfigPath` with `backend: BackendConfig`;
  remove `autoSync`, `noSync`, `syncRetries`, `fetchIntervalSeconds`

**Modify:** `src/shared/constants.ts`

- Remove `DEFAULT_DATA_DIR`
- Add `DEFAULT_BACKEND_TYPE = "sqlite"`

### Step 6: Legacy data detection + `--skip-legacy-check` flag

**New helper in:** `src/core/config.ts`

```typescript
export async function detectLegacyData(config: ResolvedConfig): Promise<string | null>
```

If `backend.type === "sqlite"`, check if the directory containing the DB also
has a `tasks/` subdirectory with `.json` files. If so, return a warning
message with exact `karya import` instructions.

**`--skip-legacy-check` global flag — end-to-end specification:**

- **Definition:** `src/cli/index.ts` — add `.option("--skip-legacy-check",
  "Skip legacy JSON file detection")` to the program-level options
- **Parsing:** `src/cli/shared/runtime.ts` — add to
  `parseGlobalOptionsFromArgv()` and `getGlobalOptions()`, flows into
  `ResolveConfigOptions.skipLegacyCheck?: boolean`
- **Config:** `ResolvedConfig.skipLegacyCheck: boolean` (default `false`)
- **Enforcement:** `runtime.runCommand()` calls `detectLegacyData(config)`.
  If it returns a warning string AND `config.skipLegacyCheck` is `false`,
  print the warning to stderr and `process.exit(1)`. If
  `skipLegacyCheck` is `true`, skip the check entirely.
- **Scope:** Applies to ALL commands (it's a global option checked in
  `runCommand` before dispatching to the handler).
- **E2E test:** `tests/e2e/cli.e2e.test.ts` — add test case: create a
  temp dir with `tasks/*.json` files, set `--db-path` to
  `<dir>/karya.db`, verify exit code 1 + warning message. Then re-run
  with `--skip-legacy-check` and verify success.

### Step 7: Refactor `TaskStore`

**Modify:** `src/core/task-store.ts`

Constructor: `constructor(private readonly backend: DbBackend)`

Key changes:
- `TaskReference`: remove `path` field → `{ task, id, bucket }`
- `ensureInitialized()`: calls `backend.initialize()`
- `resolveTaskReference()`: uses `backend.findByPrefix()` instead of
  readdir + readFile loop
- `readAllTasks()`: replaced by `backend.getAllTasks()`
- `writeTask()`: calls `backend.putTask()`, checks `written` flag. If
  `false` (conflict), fetches current via `backend.getTask()`, runs
  `reconcileTasks()`, retries `putTask()` with merged result.
- `reconcileWithExisting()`: removed as a separate method — reconciliation
  logic integrated into `writeTask()` retry loop
- `deleteTask()`: uses `backend.deleteTask(ref.id, ref.bucket)`
- `restoreTask()`: uses `backend.deleteTask()` instead of `rm(ref.path)`
- `transitionTask()`: uses `backend.deleteTask()` instead of `rm(ref.path)`
- `listProjects()`: uses `backend.getAllTasks("tasks")` to extract unique
  project names (drop `projectsDir` scanning)
- Remove all FS imports

### Step 8: Update runtime

**Modify:** `src/cli/shared/runtime.ts`

- Remove `GitSync` import
- `CommandContext`: remove `sync` field, add `backend: DbBackend`
- In `runCommand()`: use `createBackend(config.backend)` → `new TaskStore(backend)`.
  Call `detectLegacyData()` and warn/exit if found.
  Ensure `backend.close()` is called in finally block.
- `runWrite()`: just calls the operation directly (no sync wrapping)
- `CliRuntime.runWrite` signature: drop `commitMessage` parameter
- Remove `--no-sync` from `parseGlobalOptionsFromArgv`
- Remove sync-related option handling

### Step 9: Update web server

**Historical note:** This step has since been superseded. The web server has
been permanently removed — all code (`src/web/`, `src/cli/commands/serve.ts`),
dependencies (`hono`, `@hono/node-server`), and the `karya serve` command are
gone. See AGENTS.md for current architecture.

### Step 10: Update CLI commands

**Delete:** `src/cli/commands/sync.ts`

**Modify:** `src/cli/commands/config.ts`
- `config init`: calls `backend.initialize()` to create tables/DB file
- `config set`: remove sync-related keys. Add backend config keys.

**Modify:** `src/cli/commands/index.ts` — remove sync registration, add
export/import

**Modify:** `src/cli/index.ts` — remove `--no-sync` option

**Other commands** — minimal type-only changes where `CommandContext` is used

### Step 11: Add export/import commands

**New file:** `src/cli/commands/export.ts`

`karya export [--output <dir>]` — reads all tasks + archived tasks from the
backend and writes them as `<id>.json` files in `tasks/` and `archive/`
subdirectories. Uses existing `writeJsonAtomic` from `fs.ts`.

**New file:** `src/cli/commands/import.ts`

`karya import [--input <dir>]` — reads JSON files from `tasks/` and `archive/`
subdirectories, validates with `migrateTaskRecord`, and inserts via
`backend.putTask()`. Reports count of imported/skipped/conflicted.

### Step 12: Clean up removed code

- **Delete:** `src/core/git-sync.ts`
- **Delete:** `src/cli/commands/sync.ts`
- **Modify:** `src/shared/types.ts` — remove `SyncWarning` import. Replace
  `WriteResult<T>` with simpler type (just `{ result: T }`)
- Remove `proper-lockfile` and `simple-git` from dependencies
- Keep `fs.ts` (used by export command)
- Keep `migrate.ts` (used by import command for JSON → Task conversion)
- Keep `reconcile.ts` (used by TaskStore for conflict handling)

### Step 13: Package cleanup

- `git rm -r data/` + add `data/` to `.gitignore`
- Update `package.json`:
  - Description: "SQL-backed task tracker for AI agent workflows"
  - Remove deps: `simple-git`, `proper-lockfile`
  - Add dep: `better-sqlite3`
  - Add optional peer dep: `pg`
  - Add `@types/better-sqlite3` to devDeps
  - Add `"files": ["dist/", "bin/"]`
  - Add `"exports"` for core modules
- Update `tsconfig.json`: add `"declaration": true`
- Update `bin/karya`: prefer `dist/` if built

### Step 14: Update tests

**Modify:** `tests/core/task-store.test.ts`
- Change `new TaskStore(dir)` → `new TaskStore(new SqliteBackend(":memory:"))`
- Using in-memory SQLite: faster, no cleanup needed
- All domain-logic assertions unchanged

**Modify:** `tests/core/migrate.test.ts`
- Keep task JSON migration tests (still used by import command)
- Remove/update repo-config migration tests (RepoConfigSchema removed)

**Modify:** `tests/e2e/cli.e2e.test.ts`
- Replace `--data-dir` with `--db-path` pointing to a temp SQLite file
- Remove `--no-sync` flag
- Same workflow tested

**Delete:** `tests/e2e/web.e2e.test.ts`
- Removed with web server deprecation

**New:** `tests/core/backends/sqlite.test.ts`
- Direct backend CRUD tests using `:memory:` database
- Tests: getTask, putTask, findByPrefix, moveTask, deleteTask
- Tests: conditional upsert conflict detection (putTask returns
  `{ written: false }` when existing row is newer)

**New:** `tests/core/backends/pg.test.ts`
- Tests with mock `Pool` or conditional skip if `KARYA_TEST_PG_URL` not set

**Unchanged:** `tests/core/reconcile.test.ts`, `query.test.ts`,
`schema.test.ts` — pure functions, unaffected.

## Files Summary

| File | Action |
|------|--------|
| `src/core/backend.ts` | CREATE — DbBackend interface |
| `src/core/backends/sqlite.ts` | CREATE — SQLite implementation |
| `src/core/backends/pg.ts` | CREATE — PostgreSQL implementation |
| `src/core/create-backend.ts` | CREATE — factory function |
| `src/cli/commands/export.ts` | CREATE — JSON export |
| `src/cli/commands/import.ts` | CREATE — JSON import |
| `src/core/task-store.ts` | MODIFY — use DbBackend |
| `src/core/schema.ts` | MODIFY — BackendConfigSchema |
| `src/core/config.ts` | MODIFY — backend config, legacy detection |
| `src/cli/shared/runtime.ts` | MODIFY — remove sync, use factory |
| `src/cli/commands/index.ts` | MODIFY — remove sync, add export/import |
| `src/cli/commands/config.ts` | MODIFY — backend-aware init |
| `src/cli/index.ts` | MODIFY — remove --no-sync |
| `src/web/server.ts` | DELETE — removed in later plan |
| `src/shared/types.ts` | MODIFY — remove SyncWarning |
| `src/shared/constants.ts` | MODIFY — platform-aware default path |
| `src/core/git-sync.ts` | DELETE |
| `src/cli/commands/sync.ts` | DELETE |
| `data/` | DELETE from git |
| `.gitignore` | MODIFY — add data/ |
| `package.json` | MODIFY — deps, exports, files |
| `tsconfig.json` | MODIFY — declaration |
| `tests/core/task-store.test.ts` | MODIFY — use SqliteBackend |
| `tests/core/migrate.test.ts` | MODIFY — remove repo-config tests |
| `tests/e2e/cli.e2e.test.ts` | MODIFY — use --db-path |
| `tests/core/backends/sqlite.test.ts` | CREATE |
| `tests/core/backends/pg.test.ts` | CREATE |

## Verification

1. `bun run lint` — type-check passes
2. `bun run test` — all unit tests pass (using in-memory SQLite)
3. `bun run test:e2e` — CLI e2e tests pass
4. Legacy detection: run against a directory with old `tasks/*.json` files →
   prints warning with import instructions, exits 1
4b. Same with `--skip-legacy-check` → proceeds without warning
5. Manual: `karya config init` → creates SQLite DB at platform default path
6. Manual: `karya add "test task"` → task stored in SQLite
7. Manual: `karya list` → shows the task
8. Manual: `karya export --output /tmp/export` → JSON files created
9. Manual: `karya import --input /tmp/export` → tasks round-trip
10. `npm pack` → clean tarball
