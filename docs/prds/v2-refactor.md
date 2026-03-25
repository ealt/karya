# Karya v2.0.0 — Simplify Task Lifecycle

## Summary

Replace the `status` column with a `closed_at` timestamp, rename `created_at` to `opened_at`, and drop `created_by`, `updated_by`, and `updated_at`. Reduces the tasks table to 10 columns where everything earns its place.

## Problem

- `status` has four values (`open`, `in_progress`, `done`, `cancelled`) but only two matter: is this task done or not? `in_progress` requires manual discipline nobody maintains. `cancelled` vs `done` is a distinction that rarely matters — if it does, use a tag or note.
- `created_by` / `updated_by` add audit overhead for a small trusted team. Owner already captures who is responsible. If provenance matters for a specific task, put it in the note.
- `updated_at` is redundant with `opened_at` for finding stale tasks.

## Design

### Final Tasks Schema

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT,
  priority TEXT,
  owner_id TEXT REFERENCES users(id),
  assignee_id TEXT REFERENCES users(id),
  tags TEXT[] DEFAULT '{}',
  note TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
```

We considered demoting `project`, `priority`, `owner_id`, and `assignee_id` to tags but decided against it — they are the primary filter/sort/group dimensions and belong as indexed columns. Tags are for the long tail of per-task metadata that doesn't need dedicated query support.

### Users Table (unchanged from v1.0.0)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'human',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ
);
```

### Task Relations (unchanged from v1.0.0)

```sql
CREATE TABLE task_relations (
  source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('parent', 'blocks')),
  CHECK (source_id <> target_id),
  PRIMARY KEY (source_id, target_id, type)
);
```

### `closed_at` Semantics

- `NULL` → task is open
- non-NULL → task is closed (timestamp records when)
- Set automatically when closing a task
- Set to NULL when reopening

### Queries

```sql
-- Open tasks (default)
SELECT * FROM tasks WHERE closed_at IS NULL;

-- Closed tasks
SELECT * FROM tasks WHERE closed_at IS NOT NULL;

-- All tasks
SELECT * FROM tasks;
```

## CLI Changes

### Removed

- `--status` flag on `edit`, `list`, `add`
- `--author` global flag (no `created_by` to populate)
- `StatusSchema` type and all status validation

### New/Changed

- `karya list` defaults to `WHERE closed_at IS NULL` (open tasks)
- `karya list --closed` shows closed tasks
- `karya list --all` shows everything
- `karya edit <id> --close` sets `closed_at = now()`
- `karya edit <id> --reopen` sets `closed_at = NULL`
- Filter aliases do not get a new `status`, `state`, or `closed` field for this change; open vs closed remains list behavior

### Config

- `author` config key is no longer required for task creation (no `created_by`/`updated_by`)
- `karya setup` validates an existing alias and writes it to local config, or offers to create a new user if the alias does not exist

### Schema Version

`karya_meta.schema_version` → `3`

Hard-fail on schema_version < 3 with clear error message.

## Migration (for deployers)

```sql
BEGIN;
ALTER TABLE tasks ADD COLUMN closed_at TIMESTAMPTZ;
UPDATE tasks SET closed_at = updated_at WHERE status = 'done';
ALTER TABLE tasks DROP COLUMN status;
ALTER TABLE tasks RENAME COLUMN created_at TO opened_at;
ALTER TABLE tasks DROP COLUMN created_by;
ALTER TABLE tasks DROP COLUMN updated_by;
ALTER TABLE tasks DROP COLUMN updated_at;
UPDATE karya_meta SET value = '3' WHERE key = 'schema_version';
COMMIT;
```

## Scope

### In

- Replace `status` with `closed_at`
- Rename `created_at` to `opened_at`
- Drop `created_by`, `updated_by`, `updated_at`
- Update CLI commands and filters
- Schema version bump to 3
- Hard-fail on schema_version < 3

### Out

- Authentication / access control
- Automatic migration tooling
