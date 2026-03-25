# v2.0.0: Opened/Closed Lifecycle Refactor

**Issue**: <https://github.com/ealt/karya/issues/12>

## Summary

Refactor task lifecycle tracking to remove `status` entirely.

A task is now:

- open when `closedAt = null`
- closed when `closedAt` has a timestamp

Also rename `createdAt` to `openedAt` so the model reads consistently. `closedAt` records when the task was first closed, stays unchanged while the task remains closed, and is cleared on reopen.

This also removes Karya's built-in distinction between `done` and `cancelled`. Because this changes the lifecycle model again after `v1.0.0`, it should ship as `v2.0.0`. This refactor also removes task-level audit columns `createdBy`, `updatedBy`, and `updatedAt`.

## Key Changes

### Core model and schema

- Update `TaskSchema` and `Task` types:
  - remove `status`
  - rename `createdAt` to `openedAt`
  - add `closedAt: string | null`
  - remove `createdBy`
  - remove `updatedBy`
  - remove `updatedAt`
- Update SQL schema in SQLite and Postgres:
  - replace `created_at` with `opened_at`
  - remove `status`
  - add `closed_at`
  - remove `created_by`
  - remove `updated_by`
  - remove `updated_at`
- Keep schema-version enforcement and bump `karya_meta.schema_version` from `2` to `3` for this breaking lifecycle change.

### Store behavior

- `addTask` sets:
  - `openedAt = now`
  - `closedAt = null`
- `editTask` replaces status transitions with explicit close/reopen operations:
  - `--close` sets `closedAt` to `now` if currently null
  - `--close` is idempotent if already closed
  - `--reopen` sets `closedAt = null`
- Remove all status-based store logic, validation, and types.
- Remove task-level author/update auditing from store input and persistence.

### Query, filters, and aliases

- Remove `status` from list filters and alias schemas.
- Do not add a replacement `state` or `closed` boolean field to the filter schema.
- Represent open/closed selection through concrete list behavior instead:
  - default `list`: open tasks only
  - `list --closed`: closed tasks only
  - `list --all`: open and closed tasks
- Alias expansion should map to the same list behavior used by CLI flags rather than introducing a new abstract filter field.

### CLI surface

- Remove `--status` from `edit` and `list`.
- Add `--close` and `--reopen` to `edit`.
- Treat `--close` and `--reopen` as mutually exclusive; using both is a usage error.
- Update help text, examples, and command output to show:
  - `openedAt`
  - `closedAt` when present
- Stop showing `status` in human or JSON task output.

### Import/export and docs

- Update import/export payloads to use `openedAt` and `closedAt`.
- Remove references to `done`, `cancelled`, and `status` from docs, examples, changelog text, and acceptance criteria tied to this plan.
- Update setup docs to say Karya validates an existing alias or offers to create a new user; it does not claim user records.

## Migration Note

For databases already on the `v1.0.0` schema, the lifecycle change can be expressed as:

```sql
ALTER TABLE tasks ADD COLUMN closed_at TIMESTAMPTZ;
UPDATE tasks SET closed_at = updated_at WHERE status = 'done';
ALTER TABLE tasks DROP COLUMN status;
ALTER TABLE tasks RENAME COLUMN created_at TO opened_at;
ALTER TABLE tasks DROP COLUMN created_by;
ALTER TABLE tasks DROP COLUMN updated_by;
ALTER TABLE tasks DROP COLUMN updated_at;
UPDATE karya_meta SET value = '3' WHERE key = 'schema_version';
```

This preserves the existing close time approximation for tasks that were previously marked `done`. Tasks with any other status remain open after the migration unless handled separately.

## Implementation Notes

- Keep the existing repository split (`users`, `tasks`, `relations`); this change only alters task lifecycle fields and related filtering/CLI behavior.
- Backend row mappers must continue to translate between camelCase in TypeScript and snake_case in SQL.
- If a task is reopened and then closed again, `closedAt` should be set to the new close timestamp.
- Any optimistic write behavior that depended on `updatedAt` must be removed or replaced as part of this refactor.

## Test Plan

- Schema tests:
  - task parses with `openedAt` and `closedAt`
  - task no longer accepts `status`, `createdAt`, `createdBy`, `updatedBy`, or `updatedAt`
- Store tests:
  - add creates an open task with `closedAt = null`
  - close sets `closedAt`
  - repeated close preserves the original `closedAt`
  - reopen clears `closedAt`
  - reopen then close sets a new close timestamp
- Query and list tests:
  - default list returns open tasks only
  - `--closed` returns only closed tasks
  - `--all` returns both
- CLI tests:
  - `edit --close` and `edit --reopen` work end to end
  - `edit --status ...` is rejected
  - output shows `openedAt` and `closedAt`
- Backend round-trip tests:
  - SQLite and Postgres persist/read `opened_at` and `closed_at` correctly
  - initialization fails on schema versions lower than `3`
- Import/export tests:
  - exported tasks contain `openedAt` and `closedAt`
  - imported tasks round-trip without `status`

## Assumptions

- There is no built-in `done` vs `cancelled` distinction after this change.
- This remains a breaking schema change with no automatic migration of existing deployed databases.
