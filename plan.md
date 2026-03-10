**Superseded.** Original design document. The codebase has moved to SQL backends (SQLite/PostgreSQL) and the web server has been removed. See AGENTS.md for current architecture.

---

# Karya — Implementation Plan

> *Sanskrit: "what ought to be done"* — Git-backed task tracker for orchestrating AI agents across machines.

**Location:** `~/Documents/karya/`
**CLI command:** `karya`
**npm package:** `karya`

## Context

A personal task tracker optimized for agent-driven workflows. Most tasks are executed by AI agents running across multiple machines/VMs, so the tool needs to be CLI-first, easily scriptable, resilient offline, and sync seamlessly via git. The web UI is for the human to browse, triage, and prioritize.

## Architecture Overview

**Stack:** Bun + TypeScript, Commander.js (CLI), Hono + HTMX (web), Zod (validation)

**Storage:** Git repo with one JSON file per task (minimizes merge conflicts when multiple agents write concurrently)

```
<data-repo>/
  config.json               # repo-level defaults + schemaVersion
  tasks/<id>.json           # active tasks (one file each, 8-char nanoid)
  archive/<id>.json         # terminal tasks (done/cancelled)
  projects/<slug>.json      # optional project metadata
```

**App source structure:**
```
src/
  core/          # shared library: schema, task-store, git-sync, query, config
  cli/           # commander-based CLI (commands/, formatters/)
  web/           # hono server with JSX + HTMX (routes/, components/, static/)
  shared/        # types, constants
tests/           # mirrors src/ structure
```

## Data Model

```typescript
Task {
  schemaVersion: number
  id: string (8-char nanoid)
  title: string
  description: string
  project: string (default "inbox")
  tags: string[]
  priority: "P0" | "P1" | "P2" | "P3" (default "P2")
  status: "open" | "in_progress" | "done" | "cancelled"
  createdAt, updatedAt, startedAt, completedAt, dueAt: ISO datetime | null
  createdBy, updatedBy: string (e.g. "cli", "web", "agent:claude")
  parentId: string | null (for subtasks)
  notes: { body, author, timestamp }[]
}
```

Notes:
- `schemaVersion` starts at `1` and is required on all persisted records.
- `done` and `cancelled` are terminal states and files are moved to `archive/` immediately.

## CLI Design

```
karya add "Title" -p project -P P1 -t tag1,tag2 --due tomorrow
karya list --project foo --priority P0,P1 --status open
karya show <id>
karya edit <id> --priority P0 --note "context"
karya start <id> / done <id> / cancel <id>
karya delete <id>
karya sync
karya projects
karya archive [list | restore <id>]
karya config [set <key> <value> | init]
karya serve [--port 3000]
```

All commands support `--format json` for agent consumption and `--no-sync` for batch operations. Partial ID prefix matching (min 4 chars). Idempotent status transitions (no error if already done).

## Git Sync Strategy

- **Read ops:** never require network. Reads are local-first and work offline.
- **Background freshness:** optional `git fetch` in short intervals or before writes to reduce drift.
- **Write ops (default):** lock locally → pull/rebase latest → write files → `git add` → `git commit` → `git push`.
- **Push/rebase retries:** on non-fast-forward or rebase failure, retry pull/rebase + reconcile + push up to bounded attempts.
- **Conflicts:** deterministic field-level reconciliation:
  - Scalar fields (`title`, `priority`, `status`, `dueAt`, etc.): last-write-wins by `updatedAt`.
  - `notes`: append-merge + stable sort by `timestamp`.
  - Ambiguous same-field concurrent edits: preserve local value, store conflict marker in metadata/log, and return warning.
- **Offline:** writes commit locally and queue push; warnings are machine-readable in JSON mode.
- **Locking:** local file lock only protects one machine process; cross-machine consistency is handled by git retry/reconcile flow.
- **Batch mode:** `--no-sync` skips auto-sync, then `karya sync` reconciles and pushes pending commits.

## Web UI

Hono server with JSX rendering + HTMX for partial updates. PicoCSS for styling (classless, light/dark).

- Dashboard: tasks grouped by project or priority
- Filter bar: project/priority/status dropdowns trigger HTMX partial updates
- Inline actions: start/done/cancel buttons swap task card HTML via HTMX
- Add form: inline form at top, prepends new task card on submit
- JSON API: `/api/tasks` endpoints for programmatic access

## Configuration

**App config** (`~/.config/karya/karya.json`): `dataDir`, `defaultProject`, `defaultPriority`, `autoSync`, `author`, `web.port`

**Env vars** override config: `KARYA_DATA_DIR`, `KARYA_AUTHOR` (useful for agents), `KARYA_NO_SYNC`, `KARYA_FORMAT`

**Repo config** (`config.json`): `schemaVersion`, repo defaults, sync tuning (retry count, optional fetch interval)

**Resolution order:** CLI flags → env vars → app config → data repo config → defaults

## Key Dependencies

- `commander` — CLI framework
- `hono` — web server + JSX
- `htmx.org` + `typed-htmx` — HTMX with TS types
- `zod` — schema validation
- `nanoid` — ID generation (custom alphabet, 8 chars)
- `simple-git` — programmatic git ops (lazy-loaded for fast CLI startup)
- `date-fns` — date formatting/parsing
- `proper-lockfile` — file locking for concurrent access
- PicoCSS — classless CSS framework

## Implementation Phases

### Phase 1: Core + CLI (MVP)
1. Project init: `package.json`, `tsconfig.json`, eslint, prettier
2. `src/core/schema.ts` — Zod schemas and types (`schemaVersion` included)
3. `src/core/id.ts` — nanoid helper
4. `src/core/config.ts` — config loading (app + repo config)
5. `src/core/task-store.ts` — file-based CRUD + archive move semantics
6. `src/core/query.ts` — filtering and sorting
7. CLI commands: `add`, `list`, `show`, `edit`, `start`, `done`, `delete`, `projects`, `archive`
8. `--format json` output for all commands (including structured warnings)
9. Tests for core library

### Phase 2: Git Sync
10. `src/core/git-sync.ts` — fetch, pull/rebase, commit, push, retry policy
11. Deterministic reconcile logic (field-level merge + conflict warnings)
12. Wire sync into TaskStore with offline-safe reads and queued pushes
13. `karya sync` and `karya config init` commands
14. File locking + sync tests

### Phase 3: Web UI
15. Hono app with JSX + PicoCSS + HTMX
16. Dashboard, task list, task detail routes
17. Add/edit forms with HTMX
18. Inline status transitions (including archive-on-terminal states)
19. JSON API endpoints
20. `karya serve` command

### Phase 4: Polish
21. Partial ID matching
22. Relative date parsing for `--due`
23. Error messages and edge cases
24. Migration helpers for future schema versions
25. README

## Verification

1. **CLI smoke test:** `karya config init` → `karya add "Test" -P P1` → `karya list` → `karya done <id>` → `karya archive list`
2. **Offline reads:** disconnect network, run `karya list` and `karya show <id>` successfully
3. **JSON output:** `karya list --format json | jq .` parses correctly, warnings are structured
4. **Git sync:** init data repo, add tasks from two clones, verify retry/reconcile behavior and no data loss for `notes`
5. **Web UI:** `karya serve`, open browser, add/edit/complete tasks, verify HTMX updates and archive behavior
6. **Unit tests:** `bun test` passes for core library (schema, store, query, sync)
