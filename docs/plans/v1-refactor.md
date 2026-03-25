# v1.0.0: Multi-User Schema Redesign

**Issue**: https://github.com/ealt/karya/issues/9

## Context

Karya is a single-user SQL-backed task tracker CLI. As usage grows, the freeform author strings, embedded notes, limited relationships, and tag-based metadata create friction. This redesign introduces a proper users table, normalizes task columns, simplifies notes to a single optional string field on tasks, externalizes relations into their own table, and adds CLI ergonomics (surgical tag ops, filter aliases, interactive setup).

## Design Decisions

1. **Remove archive/bucket entirely** — no bucket column, no archive commands. Terminal status tasks are filtered via `list --status`.
2. **Per-entity repositories** — `DbBackend` exposes `.users`, `.tasks`, and `.relations` sub-objects.
3. **camelCase in TS, snake_case in SQL** — backend layer maps between conventions.
4. **Schema version check** — A `karya_meta` table stores `schema_version=2`. On startup, `initialize()` checks this: if the table exists with version 1 (or the old `tasks` table has a `bucket` column), hard-fail with a clear error. If no tables exist, create fresh v2 schema.
5. **Hard-fail on missing identity** — Any mutating command without a configured+existing user fails with "No user configured. Run `karya setup` first." The `setup` command and `users add` are exempt (they create users).
6. **Each task has a single optional note string** — `tasks.note` stores either short inline text, a URI, or `null`. Karya does not manage multi-note state.
7. **User deactivation, not deletion** — `users remove` sets a `deactivatedAt` timestamp. Deactivated users can't be assigned but their audit trail is preserved.
8. **Relation integrity constraints** — `CHECK(source_id <> target_id)` prevents self-references. Single-parent enforced via `UNIQUE(source_id)` where `type='parent'` (in store layer for SQLite, partial unique index for PG). Cycle detection in store layer.
9. **Structured filter aliases** — Config uses objects, not raw CLI strings: `{ "mine": { "owner": "me" } }`.
10. **Bottom-up, all at once** — schemas -> backend -> stores -> CLI, tests alongside.

---

## Phase 1: Core Types & Utilities

### 1.1 `src/shared/constants.ts`
- Remove `DEFAULT_SCHEMA_VERSION`
- Add `SCHEMA_VERSION = 2`
- Keep `DEFAULT_PROJECT`, `DEFAULT_PRIORITY`, `DEFAULT_FORMAT`, `DEFAULT_BACKEND_TYPE`, `MIN_ID_PREFIX`

### 1.2 `src/core/schema.ts` — Complete rewrite
Drop: `TaskConflictSchema`, old `TaskNoteSchema` (body/author/timestamp), old `TaskSchema` (17 fields)

New schemas:
```typescript
UserTypeSchema = z.enum(["human", "agent"])

UserSchema = z.object({
  id: z.string().length(8),
  name: z.string().min(1),
  alias: z.string().min(1),
  type: UserTypeSchema.default("human"),
  createdAt: z.string().datetime(),
  deactivatedAt: z.string().datetime().nullable().default(null),
})

PrioritySchema (unchanged)
StatusSchema (unchanged)

TaskSchema = z.object({
  id: z.string().length(8),
  title: z.string().min(1),
  project: z.string().min(1).default(DEFAULT_PROJECT),
  priority: PrioritySchema.default(DEFAULT_PRIORITY),
  status: StatusSchema.default("open"),
  note: z.string().nullable().default(null),   // inline text, URI, or null
  ownerId: z.string().length(8).nullable().default(null),
  assigneeId: z.string().length(8).nullable().default(null),
  createdBy: z.string().length(8),
  updatedBy: z.string().length(8),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

RelationTypeSchema = z.enum(["parent", "blocks"])

TaskRelationSchema = z.object({
  sourceId: z.string().length(8),
  targetId: z.string().length(8),
  type: RelationTypeSchema,
})

// Structured filter alias value schema
FilterAliasValueSchema = z.object({
  project: z.string().optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  owner: z.string().optional(),         // alias or "me" or "none"
  assignee: z.string().optional(),      // alias or "me" or "none"
  assigneeType: UserTypeSchema.optional(),  // filter by assignee's user type
})

ListFiltersSchema = z.object({
  project: z.array(z.string()).optional(),
  priority: z.array(PrioritySchema).optional(),
  status: z.array(StatusSchema).optional(),
  tag: z.array(z.string()).optional(),
  ownerId: z.string().optional(),
  assigneeId: z.string().optional(),
  assigneeType: UserTypeSchema.optional(),  // requires join to users table
})

AppConfigSchema = z.object({
  backend: BackendConfigSchema.optional(),
  defaultProject: z.string().min(1).default(DEFAULT_PROJECT),
  defaultPriority: PrioritySchema.default(DEFAULT_PRIORITY),
  author: z.string().min(1).default("cli"),       // user alias
  autoTags: z.array(z.string()).default([]),
  filterAliases: z.record(z.string(), FilterAliasValueSchema).default({}),
})

BackendConfigSchema (unchanged)
```

Exported types: `User`, `UserType`, `Task`, `TaskRelation`, `RelationType`, `Priority`, `TaskStatus`, `FilterAliasValue`, `ListFilters`, `AppConfig`, `BackendConfig`

### 1.3 `src/core/id.ts`
- Rename `createTaskId` -> `createId` (used for users and tasks)
- Keep the same nanoid(8) implementation

### 1.4 `src/core/dates.ts`
- Remove `parseDueInput` (no more `dueAt`/`--due`)
- Keep `nowIso`

### 1.5 `src/core/errors.ts`
- Add error code `SCHEMA_MISMATCH` for version check failures
- Keep all existing codes

---

## Phase 2: Backend Interface & Implementations

### 2.1 `src/core/backend.ts` — Complete rewrite

```typescript
export interface WriteResult { written: boolean }

export interface UserRepository {
  getUser(id: string): Promise<User | null>;
  getUserByAlias(alias: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  putUser(user: User): Promise<void>;
  // No deleteUser — deactivation is handled via putUser with deactivatedAt set
}

export interface TaskRepository {
  getTask(id: string): Promise<Task | null>;
  getAllTasks(): Promise<Task[]>;
  findByPrefix(prefix: string): Promise<Task[]>;
  putTask(task: Task): Promise<WriteResult>;
  deleteTask(id: string): Promise<void>;
}

export interface TaskRelationRepository {
  getRelationsForTask(taskId: string): Promise<TaskRelation[]>;
  putRelation(relation: TaskRelation): Promise<void>;
  deleteRelation(sourceId: string, targetId: string, type: RelationType): Promise<void>;
}

export interface DbBackend {
  initialize(): Promise<void>;   // creates tables + schema version check
  close(): Promise<void>;
  users: UserRepository;
  tasks: TaskRepository;
  relations: TaskRelationRepository;
}
```

Remove: `Bucket` type, `moveTask`, all bucket parameters.

### 2.2 `src/core/backends/sqlite.ts` — Complete rewrite

`initialize()` flow:
1. Check for `karya_meta` table. If absent, check if old `tasks` table exists with `bucket` column → hard-fail with `SCHEMA_MISMATCH` error: "Database uses v0 schema. Please use a fresh database for v1."
2. If `karya_meta` exists with `schema_version != 2` → hard-fail.
3. If no tables exist → create all tables + insert `karya_meta` row.

DDL:
```sql
CREATE TABLE IF NOT EXISTS karya_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO karya_meta (key, value) VALUES ('schema_version', '2');

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human','agent')),
  created_at TEXT NOT NULL,
  deactivated_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT 'inbox',
  priority TEXT NOT NULL DEFAULT 'P2' CHECK(priority IN ('P0','P1','P2','P3')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','cancelled')),
  note TEXT,
  owner_id TEXT REFERENCES users(id),
  assignee_id TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_relations (
  source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('parent','blocks')),
  CHECK(source_id <> target_id),
  PRIMARY KEY (source_id, target_id, type)
);

-- Single-parent constraint: a task can have at most one parent relation
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_single_parent
  ON task_relations (source_id) WHERE type = 'parent';
```

Implementation notes:
- Tags stored as JSON text in SQLite, parsed on read
- `putTask` uses normalized columns with same `ON CONFLICT ... WHERE updated_at <=` optimistic lock
- Implements `DbBackend` by composing three repository objects
- Maps camelCase <-> snake_case in row read/write helpers
- `PRAGMA foreign_keys = ON` (already in current code)

### 2.3 `src/core/backends/pg.ts` — Complete rewrite
Same table structure with PostgreSQL types:
- `tags` as `TEXT[]` (not JSON text)
- `TIMESTAMPTZ` for timestamp columns
- `text_pattern_ops` index on tasks.id for prefix search
- Partial unique index for single-parent: `CREATE UNIQUE INDEX ... ON task_relations (source_id) WHERE type = 'parent'`
- Same `karya_meta` schema version check logic
- Preserve existing `createPool`, `PgSslOptions`, connection string redaction

### 2.4 `src/core/create-backend.ts`
No structural changes — factory still returns `DbBackend`.

---

## Phase 3: Store / Domain Layer

### 3.1 `src/core/user-store.ts` — New file

```typescript
export class UserStore {
  constructor(private readonly backend: DbBackend) {}

  async addUser(input: { name: string; alias: string; type?: UserType }): Promise<User>
  async listUsers(includeDeactivated?: boolean): Promise<User[]>
  async editUser(idOrAlias: string, updates: { name?: string; alias?: string; type?: UserType }): Promise<User>
  async deactivateUser(idOrAlias: string): Promise<User>  // sets deactivatedAt
  async resolveUser(aliasOrId: string): Promise<User>     // lookup by alias first, then by id; throws if deactivated

  // Used by runtime to validate configured author
  async requireActiveUser(alias: string): Promise<User>   // throws NOT_FOUND or INVALID_STATE if deactivated
}
```

Reuse `createId()` from `id.ts`. Validate alias uniqueness (backend enforces via UNIQUE constraint; store throws clear error).

### 3.2 `src/core/task-store.ts` — Major rewrite

**Remove**: `startTask`, `doneTask`, `cancelTask`, `restoreTask`, all `Bucket` references, archive bucket logic

**Updated interfaces**:
```typescript
export interface AddTaskInput {
  title: string;
  project?: string;
  tags?: string[];
  priority?: Priority;
  note?: string | null;  // inline text, URI, or null
  ownerId?: string;
  assigneeId?: string;
  parentId?: string;     // creates a "parent" relation
}

export interface EditTaskInput {
  title?: string;
  project?: string;
  priority?: Priority;
  status?: TaskStatus;
  note?: string | null;   // replaces current note
  ownerId?: string | null;
  assigneeId?: string | null;
  addTags?: string[];
  rmTags?: string[];
  editTags?: string[];   // each "key:value" — replaces existing tag with same key prefix
}

export interface TaskDetail {
  task: Task;
  relations: TaskRelation[];
}
```

**Updated methods**:
- `addTask(input, createdBy, defaults)` — creates task, optionally sets `task.note`, and optionally creates a parent relation
- `editTask(idOrPrefix, updates, updatedBy)` — supports `status` changes (replacing transitions), surgical tag ops. Validates owner/assignee are active users if provided.
- `deleteTask(idOrPrefix)` — simplified, no bucket param.
- `showTask(idOrPrefix)` — returns `TaskDetail` (task + relations via `backend.relations`)
- `listTasks(options)` — filters include `ownerId`/`assigneeId`
- `listProjects()` — unchanged logic
- `addRelation(sourceIdOrPrefix, targetIdOrPrefix, type)` — resolves both IDs, validates no cycle for "parent" type (walk ancestors), creates relation
- `removeRelation(sourceId, targetId, type)` — delegates
- `resolveTaskReference(idOrPrefix)` — simplified, returns `{ task: Task; id: string }` (no bucket)

**Tag operations in editTask**:
```typescript
let tags = [...existingTask.tags];
if (updates.addTags) tags.push(...updates.addTags.filter(t => !tags.includes(t)));
if (updates.rmTags) tags = tags.filter(t => !updates.rmTags!.includes(t));
if (updates.editTags) {
  for (const spec of updates.editTags) {
    const prefix = spec.split(":")[0] + ":";
    tags = tags.filter(t => !t.startsWith(prefix));
    tags.push(spec);
  }
}
```

**Parent cycle detection** (in `addRelation` when type is "parent"):
Walk the ancestor chain from `targetId` upward (follow "parent" relations). If `sourceId` is found in the chain, throw `VALIDATION` error.

### 3.3 `src/core/reconcile.ts` — Simplify
- Remove `mergeNotes`
- Remove `conflicts` field handling
- Reconcile flat task fields only; tags merge as union of both arrays (deduplicated)
- Last-writer-wins by `updatedAt` for scalar fields including `note`

### 3.4 `src/core/query.ts` — Update
- Add `ownerId` and `assigneeId` filter support
- Add `assigneeType` filter: requires resolving assigneeId -> user lookup to check type. Implementation: `filterTasks` accepts a `userLookup: (id: string) => User | null` callback (or pre-resolved map) so it can check `users.type` for the `assigneeType` filter without needing direct DB access.
- Remove `includeArchive` (no archive concept)

### 3.5 `src/core/config.ts` — Update
- `ResolvedConfig` gains: `autoTags: string[]`, `filterAliases: Record<string, FilterAliasValue>`
- `resolveConfig()` propagates new fields from `appConfig`
- `setAppConfigValue()` gains handlers for `autoTags` and `filterAliases.*`
- Remove `detectLegacyData` function
- Remove `migrateLegacyConfig` function
- Remove `--skip-legacy-check` option handling (legacy check is replaced by schema version check in backend)

### 3.6 `src/core/migrate.ts` — Delete
Data migration is out of scope per the issue.

---

## Phase 4: CLI Commands

### 4.1 `src/cli/index.ts` — Update global options
- Keep `--author <alias>` (semantic change: now a user alias, not freeform)
- Remove `--data-dir` (legacy alias)
- Remove `--skip-legacy-check`
- Keep `--db-path`, `--format`

### 4.2 `src/cli/shared/runtime.ts` — Update

**CommandContext** gains `userStore`:
```typescript
export interface CommandContext {
  config: ResolvedConfig;
  store: TaskStore;
  userStore: UserStore;
  backend: DbBackend;
}
```

`runCommand` creates both `TaskStore` and `UserStore`. For mutating commands, validates the configured author exists as an active user via `userStore.requireActiveUser(config.author)`. If it fails, the error message says "No user configured. Run `karya setup` first."

Exception: `setup` and `users add` commands bypass this check (they create users). This can be implemented by having those commands not use `runCommand`, or by passing a flag to skip user validation.

Remove `toConflictWarning` helper (no more conflicts field).

### 4.3 `src/cli/commands/transitions.ts` — Delete
Replaced by `edit --status`.

### 4.4 `src/cli/commands/archive.ts` — Delete
No archive concept.

### 4.5 `src/cli/commands/add.ts` — Rewrite
Remove: `-d/--description`, `--due`
Keep: `--parent <id>`
Add: `--owner <alias>`, `--assignee <alias>`, `--note <value>` (stores exact string on `task.note`)

Auto-defaults:
- `ownerId` from configured user (resolved via `userStore`)
- `assigneeId` from configured user
- Append `config.autoTags` to user-provided tags

### 4.6 `src/cli/commands/edit.ts` — Major rewrite
Remove: `--description`, `--due`, `--clear-due`
Add:
- `-s, --status <status>` — replaces start/done/cancel
- `--owner <alias>`, `--assignee <alias>` — resolve via userStore
- `--add-tag <tag>`, `--rm-tag <tag>`, `--edit-tag <tag>` — surgical tag ops (mutually exclusive with `-t/--tags`)
- `--parent <id>`, `--blocks <id>`, `--blocked-by <id>` — create relations after applying field edits
- `--note <value>` — replace the task note with the exact provided string

For relations, after applying the task edit:
- `--parent <id>` -> `store.addRelation(taskId, parentId, "parent")`
- `--blocks <id>` -> `store.addRelation(taskId, blockedId, "blocks")`
- `--blocked-by <id>` -> `store.addRelation(blockerId, taskId, "blocks")`

### 4.7 `src/cli/commands/users.ts` — New file
Subcommand group following existing `archive.ts` pattern:
```
karya users add --name "Eric Alt" --alias ealt [--type agent]
karya users list [--include-deactivated]
karya users edit <id-or-alias> [--name <name>] [--alias <alias>] [--type <type>]
karya users remove <id-or-alias>    # deactivates, does not delete
```

`users add` and `users list` bypass the "require active user" check in `runCommand` (they need to work before setup).

### 4.8 `src/cli/commands/setup.ts` — New file
Interactive flow using `node:readline` (`createInterface`):
1. Prompt backend type (sqlite/pg), default sqlite
2. If sqlite: prompt db path (default: platform-specific default from `config.ts:defaultDbPath`)
3. If pg: prompt connection string, SSL mode
4. Write backend config via `saveAppConfig`
5. Initialize backend (create tables via `createBackend` + `backend.initialize()`)
6. Prompt user name (default: `os.userInfo().username`), alias, type (default: human)
7. Create user in backend via `UserStore.addUser()`
8. Set `author` in config to the new alias via `saveAppConfig`
9. Print summary

Non-interactive fallback: accept all values via flags (`--backend-type`, `--db-path`, `--connection-string`, `--name`, `--alias`, `--type`). Detect `!process.stdin.isTTY` and require flags.

`setup` does NOT use `runCommand` — it needs to create config before connecting.

### 4.9 `src/cli/commands/list.ts` — Update
- Remove `--archive` flag
- Add `--owner <alias>`, `--assignee <alias>` filter flags
- Add optional positional `[alias]` argument for filter alias expansion

Filter alias expansion:
```typescript
// If positional alias arg provided, look up in config.filterAliases
const aliasConfig = context.config.filterAliases[alias];
// Merge: CLI flags override alias values
// Resolve "me" -> config.author -> userId via userStore
```

### 4.10 `src/cli/commands/show.ts` — Update
- Remove `--active-only` (no archive)
- Show enriched output: task + relations (from `store.showTask()`)
- Show the raw `task.note` value when present

### 4.11 `src/cli/commands/delete.ts` — Update
- Remove `--archive` flag
- Simple delete by id/prefix

### 4.12 `src/cli/commands/config.ts` — Update
- Remove `--skip-legacy-check` handling
- `config set` supports new keys: `autoTags` (JSON array string), `filterAliases.<name>` (JSON object string)
- `config init` updated to work with new schema

### 4.13 `src/cli/commands/projects.ts` — No changes needed

### 4.14 `src/cli/commands/export.ts` — Update
- Export all three entities: users, tasks, relations as separate subdirectories
- Remove bucket/archive distinction

### 4.15 `src/cli/commands/import.ts` — Update
- Import all three entities (users first, then tasks, then relations for FK ordering)
- Remove bucket/archive references
- Remove dependency on `migrate.ts`

### 4.16 `src/cli/commands/index.ts` — Update registrations
Remove: `registerTransitionCommands`, `registerArchiveCommand`
Add: `registerUsersCommand`, `registerSetupCommand`

### 4.17 `src/cli/formatters/output.ts` — Update
- `formatTaskLine` shows owner/assignee if present (just the ID for now; could resolve to alias if userStore available)
- Add `formatTaskDetail` for `show` output: renders task fields, optional note, and relations

### 4.18 `src/cli/shared/aliases.ts` — New file
Filter alias expansion helper:
```typescript
export function expandFilterAlias(
  aliasValue: FilterAliasValue,
  currentAuthor: string,
): Partial<ListTaskOptions>
```
Maps structured alias config to `ListTaskOptions`, resolving `"me"` -> `currentAuthor`.

---

## Phase 5: Tests

### 5.1 `tests/core/schema.test.ts` — Rewrite
- Test `UserSchema` (defaults, deactivatedAt nullable)
- Test new `TaskSchema` (defaults, includes nullable `note`, no description/dueAt/schemaVersion/parentId)
- Test `TaskRelationSchema`
- Test `FilterAliasValueSchema`
- Test `AppConfigSchema` with new fields

### 5.2 `tests/core/backends/sqlite.test.ts` — Rewrite
- Test all three repository interfaces
- Test FK constraints (task with nonexistent created_by fails)
- Test optimistic locking on putTask (normalized columns)
- Test prefix lookup (no bucket)
- Test schema version check: fresh DB succeeds, v0 DB fails with clear error
- Test single-parent constraint (second parent relation fails)
- Test self-reference constraint

### 5.3 `tests/core/backends/pg.test.ts` — Update
- Mirror SQLite tests for PG backend

### 5.4 `tests/core/user-store.test.ts` — New
- Add, list, edit, deactivate, resolve (by id and alias)
- Alias uniqueness constraint
- Deactivated user can't be resolved for assignment
- `requireActiveUser` throws on missing/deactivated

### 5.5 `tests/core/task-store.test.ts` — Rewrite
- Test addTask with normalized fields
- Test editTask with `status` changes (replacing transition tests)
- Test surgical tag operations (addTags, rmTags, editTags)
- Test note replace behavior on add/edit/show
- Test relation CRUD (addRelation, removeRelation)
- Test parent cycle detection
- Test that assigning deactivated user as owner/assignee fails

### 5.6 `tests/core/reconcile.test.ts` — Update
- Adapt to flat fields (no notes merge, no conflicts array)

### 5.7 `tests/core/query.test.ts` — Update
- Add tests for `ownerId`, `assigneeId` filters

### 5.8 `tests/core/config.test.ts` — Update
- Test `autoTags` and `filterAliases` loading/saving
- Test structured `FilterAliasValue` parsing

### 5.9 `tests/cli/shared/aliases.test.ts` — New
- Structured alias expansion
- `"me"` resolution
- Unknown alias error

### 5.10 `tests/cli/commands/index.test.ts` — Update
- Verify `start`, `done`, `cancel`, `archive` NOT registered
- Verify `users`, `setup` ARE registered

### 5.11 `tests/e2e/cli.e2e.test.ts` — Rewrite
- New workflow: `setup` (non-interactive via flags) -> `add` -> `edit --status done` -> `list --status done`
- Test `start`/`done`/`cancel` are unknown commands
- Test user CRUD via CLI (`users add`, `users list`, `users remove`)
- Test `--owner`/`--assignee` flags on add and list
- Test that commands fail without setup

---

## Phase 6: Cleanup

- Delete `src/core/migrate.ts`
- Delete `src/cli/commands/transitions.ts`
- Delete `src/cli/commands/archive.ts`
- Remove `detectLegacyData` and `migrateLegacyConfig` from `config.ts`
- Remove `--skip-legacy-check` from global options and `runtime.ts`
- Remove `--data-dir` global option (legacy)
- Bump `package.json` version to `1.0.0`
- Update `AGENTS.md` with new architecture (3 tables, no bucket/archive, user/task stores, schema version check)

---

## File Summary

| File | Action |
|------|--------|
| `src/shared/constants.ts` | Modify |
| `src/core/schema.ts` | Rewrite |
| `src/core/id.ts` | Modify (`createTaskId` -> `createId`) |
| `src/core/dates.ts` | Modify (remove `parseDueInput`) |
| `src/core/errors.ts` | Modify (add `SCHEMA_MISMATCH`) |
| `src/core/backend.ts` | Rewrite (3 repository interfaces) |
| `src/core/backends/sqlite.ts` | Rewrite (3 tables, schema version) |
| `src/core/backends/pg.ts` | Rewrite (3 tables, PG types) |
| `src/core/create-backend.ts` | No change |
| `src/core/user-store.ts` | **New** |
| `src/core/task-store.ts` | Major rewrite |
| `src/core/reconcile.ts` | Simplify |
| `src/core/query.ts` | Update (new filters) |
| `src/core/config.ts` | Update (new fields, remove legacy) |
| `src/core/migrate.ts` | **Delete** |
| `src/core/fs.ts` | No change |
| `src/cli/index.ts` | Update (remove legacy options) |
| `src/cli/shared/runtime.ts` | Update (userStore, identity check) |
| `src/cli/shared/aliases.ts` | **New** (structured alias expansion) |
| `src/cli/commands/index.ts` | Update registrations |
| `src/cli/commands/add.ts` | Rewrite |
| `src/cli/commands/edit.ts` | Major rewrite |
| `src/cli/commands/list.ts` | Update (new filters, aliases) |
| `src/cli/commands/show.ts` | Update (enriched detail) |
| `src/cli/commands/delete.ts` | Simplify |
| `src/cli/commands/config.ts` | Update (new config keys) |
| `src/cli/commands/users.ts` | **New** |
| `src/cli/commands/setup.ts` | **New** |
| `src/cli/commands/projects.ts` | No change |
| `src/cli/commands/export.ts` | Update (3 entities) |
| `src/cli/commands/import.ts` | Update (3 entities) |
| `src/cli/commands/transitions.ts` | **Delete** |
| `src/cli/commands/archive.ts` | **Delete** |
| `src/cli/formatters/output.ts` | Update |
| `src/shared/types.ts` | No change |
| `AGENTS.md` | Update |
| `package.json` | Bump to 1.0.0 |

Tests:

| File | Action |
|------|--------|
| `tests/core/schema.test.ts` | Rewrite |
| `tests/core/backends/sqlite.test.ts` | Rewrite |
| `tests/core/backends/pg.test.ts` | Update |
| `tests/core/user-store.test.ts` | **New** |
| `tests/core/task-store.test.ts` | Rewrite |
| `tests/core/reconcile.test.ts` | Update |
| `tests/core/query.test.ts` | Update |
| `tests/core/config.test.ts` | Update |
| `tests/cli/shared/aliases.test.ts` | **New** |
| `tests/cli/commands/index.test.ts` | Update |
| `tests/e2e/cli.e2e.test.ts` | Rewrite |

---

## Verification

1. `bun run lint` — type-check passes
2. `bun run test` — all unit/integration tests pass
3. `bun run test:e2e` — e2e workflow passes
4. Manual smoke test:
   ```bash
   bun run dev -- setup --backend-type sqlite --db-path /tmp/test.db --name "Test" --alias test
   bun run dev -- --db-path /tmp/test.db users list
   bun run dev -- --db-path /tmp/test.db add "Ship MVP" -P P1 --note "initial context"
   bun run dev -- --db-path /tmp/test.db list
   bun run dev -- --db-path /tmp/test.db edit <id> --status done --add-tag shipped
   bun run dev -- --db-path /tmp/test.db list --status done
   bun run dev -- --db-path /tmp/test.db --format json show <id>
   bun run dev -- --db-path /tmp/test.db edit <id> --blocks <other-id>
   bun run dev -- --db-path /tmp/test.db users remove test
   ```
