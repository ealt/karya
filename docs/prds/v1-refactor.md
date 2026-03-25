# Karya v1.0.0: Multi-User and Schema Redesign

## Summary

Karya v1.0.0 redesigns the task model around explicit users, normalized SQL
tables, relationship support, and better CLI ergonomics. It removes the
archive/bucket concept, keeps terminal tasks in the main task set, and adds a
first-run `setup` flow for backend configuration and local user identity.

This is a breaking schema change.

## Problem Statement

Karya was built as a single-user task tracker. As usage grows, several issues
become limiting:

1. There is no real user identity model. Authors are freeform strings and
   cannot be validated.
2. Important metadata lives in tags. Owner and assignee are encoded as tag
   conventions instead of first-class fields.
3. Tag editing is destructive. `karya edit -t` replaces the entire tag set.
4. The task schema includes fields that are not meaningfully maintained in
   practice: `description`, `startedAt`, `completedAt`, `dueAt`,
   `schemaVersion`, and `parentId`.
5. Notes are embedded inside the task record and cannot be managed
   independently.
6. Relationships are too limited. `parentId` supports only one built-in
   relationship type.
7. There is no setup flow for backend configuration and user identity.
8. Archive/bucket adds complexity without enough value. Terminal tasks can be
   filtered by `status` instead.

## Goals

- Introduce a first-class users model
- Normalize tasks into queryable SQL columns
- Move notes and relations into separate tables
- Replace archive/bucket with status-based filtering
- Add better CLI support for users, relations, and surgical tag updates
- Add an interactive and non-interactive `setup` command
- Enforce schema compatibility explicitly instead of failing implicitly

## Non-Goals

- Authentication or access control
- Ownership semantics on user records
- Automatic migration of existing deployed databases
- Web UI
- Notifications
- External URI resolution

## Key Decisions

1. Archive/bucket is removed entirely.
2. The SQL model is normalized across four tables: `users`, `tasks`,
   `task_notes`, and `task_relations`.
3. TypeScript uses camelCase and SQL uses snake_case, with mapping isolated to
   the backend layer.
4. Schema compatibility is enforced through a `karya_meta` table with
   `schema_version = 2`.
5. Mutating commands hard-fail if no configured active user exists.
6. Notes support both inline text and external references via URI strings.
7. Users are deactivated rather than deleted.
8. Relation integrity is enforced for self-reference, single-parent, and parent
   cycles.
9. Filter aliases are structured config objects, not raw CLI fragments.

## Data Model

### Users

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

Fields:

- `alias` is the user-facing shorthand such as `ealt`
- `type` is `human` or `agent`
- `deactivated_at` preserves audit history while preventing new assignment

### Tasks

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project TEXT,
  priority TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  owner_id TEXT REFERENCES users(id),
  assignee_id TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Queryable fields:

- `project`
- `priority`
- `status`
- `owner_id`
- `assignee_id`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Removed from v0:

- `description`
- `startedAt`
- `completedAt`
- `dueAt`
- `schemaVersion`
- `parentId`
- archive/bucket state

### Task Notes

```sql
CREATE TABLE task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  author_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes are URI-based:

- Inline note text is stored as `text:...`
- External references such as `file:///...` or `s3://...` are stored as-is
- Karya renders `text:` notes directly and otherwise shows the stored URI

### Task Relations

```sql
CREATE TABLE task_relations (
  source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, type)
);
```

Relation types:

- `parent`: source is child, target is parent
- `blocks`: source blocks target

Constraints:

- no self-reference
- at most one parent per task
- no parent cycles

## Setup and Identity

`karya setup` is the first-run flow for backend configuration and local user
identity.

Flow:

1. Configure backend connection
2. Initialize the database
3. Prompt for alias
4. If the alias exists, save it to local config
5. If the alias does not exist, offer to create a new user record
6. Write config to `~/.config/karya/karya.json`
7. Verify the setup with a simple command

Important:

- `setup` does not claim a user record
- there is no ownership model on users
- if an alias already exists, Karya only validates it and writes it to local
  config

Mutating commands require a configured active user. If none exists, the command
fails with a clear error telling the user to run `karya setup`.

## CLI Changes

### Removed Commands and Flags

- remove `karya start`
- remove `karya done`
- remove `karya cancel`
- remove archive commands
- remove `--due`
- remove `--description`

Replacements:

```bash
karya edit <id> --status in_progress
karya edit <id> --status done
karya edit <id> --status cancelled
```

### New Commands

```bash
karya users add --name "Eric Alt" --alias ealt
karya users add --name "fraxl" --alias fraxl --type agent
karya users list
karya users edit <id-or-alias> --alias eric.alt
karya users remove <id-or-alias>
karya setup
```

`karya users remove` deactivates a user instead of deleting the record.

### Relationship Flags

```bash
karya edit <id> --parent <parent-id>
karya edit <id> --blocks <other-id>
karya edit <id> --blocked-by <other-id>
```

### Tag Operations

```bash
karya edit <id> --add-tag size:small
karya edit <id> --rm-tag blocked
karya edit <id> --edit-tag size:large
```

### Notes

```bash
karya add "Ship MVP" --note "initial context"
karya edit <id> --note "follow-up"
karya edit <id> --note-uri "file:///docs/spec.md"
```

Rules:

- `--note <text>` always creates an inline `text:` note
- `--note-uri <uri>` stores an external URI as-is

### Filter Aliases

Config example:

```json
{
  "author": "ealt",
  "autoTags": ["size:medium"],
  "filterAliases": {
    "mine": { "owner": "me" },
    "delegated": { "assigneeType": "agent" },
    "unassigned": { "assignee": "none" }
  }
}
```

Usage:

```bash
karya list mine
karya list delegated
```

### Add Defaults

On `karya add`:

- `owner_id` defaults to the configured user unless overridden
- `assignee_id` defaults to the configured user unless overridden
- `created_by` is always the configured user
- `autoTags` are appended to explicit tags

## Schema Compatibility

This is a breaking schema change.

- Existing v0 SQL databases are not auto-migrated
- Existing legacy data migration flows are not part of this PRD
- On startup, if Karya detects the old SQL schema, it fails with a clear schema
  mismatch error
- Deployers are responsible for instance-specific migration strategy

## Scope

### In Scope

- users table plus CRUD and deactivation
- tasks schema redesign
- task notes table
- task relations table
- archive/bucket removal
- surgical tag operations
- structured filter aliases
- auto-default owner, assignee, and author behavior
- `karya setup`
- schema version enforcement

### Out of Scope

- authentication and access control
- ownership semantics on user records
- web UI
- notifications
- automatic migration of deployed databases
- external URI resolution
