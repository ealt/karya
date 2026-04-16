# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.3] - 2026-04-16

### Fixed

- `PgBackend.initialize()` no longer runs DDL when schema version already
  matches, so PostgreSQL users with DML-only privileges can connect without
  `CREATE` permission on the schema
- `loadAppConfig()` now surfaces Zod validation errors instead of silently
  falling back to SQLite defaults when the config file exists but contains
  invalid values
- Zod schemas for `UserSchema` and `TaskSchema` now coerce `Date` objects to
  ISO strings, preventing validation failures when the `pg` driver returns
  `TIMESTAMPTZ` values as `Date` instances
- `karya list` and `karya show` now display user aliases instead of raw user
  IDs for owner and assignee fields

## [2.0.2] - 2026-03-26

### Fixed

- Helpful error message when PostgreSQL backend is selected but the `pg`
  package is not installed

## [2.0.1] - 2026-03-26

### Fixed

- PostgreSQL reads now normalize `TIMESTAMPTZ` values returned as JavaScript
  `Date` objects into ISO timestamp strings before schema validation
- CLI e2e tests now clear inherited `KARYA_*` environment variables before
  spawning subprocesses so local shell config does not leak into test cases

## [2.0.0] - 2026-03-26

### Changed

- Task lifecycle simplified to open/closed — `closedAt` timestamp replaces
  `status` column; a task is open when `closedAt` is null, closed when set
- `created_at` renamed to `opened_at` across both SQL backends
- `edit --close` and `edit --reopen` replace `edit --status` for lifecycle
  transitions
- `list` defaults to open tasks; `list --closed` shows closed tasks;
  `list --all` shows both
- Schema version bumped to 3 with hard failure on older versions
- Task creation no longer requires a configured author
- `putTask` uses last-write-wins instead of optimistic concurrency

### Removed

- `status` field and `StatusSchema` validation
- `created_by`, `updated_by`, and `updated_at` audit columns
- `--status` flag from `edit` and `list` commands
- Optimistic write-conflict reconciliation (`reconcile.ts`)

## [1.0.0] - 2026-03-25

### Added

- Multi-user data model with first-class `users`, normalized `tasks`, and
  `task_relations` tables for SQLite and PostgreSQL backends
- Interactive `karya setup` flow plus `users add|list|edit|remove` commands
- Structured filter aliases and auto-tags in app config
- Owner and assignee fields with list filtering, task assignment defaults, and
  assignee-type filtering
- Schema version enforcement through `karya_meta`, including hard failure on
  legacy v0 SQL schemas
- Task relations for `parent` and `blocks`

### Changed

- Task notes are now a single optional `note` string on each task instead of an
  append-only embedded notes array
- The CLI now uses `edit --status` for state changes instead of dedicated
  transition commands
- Export/import now works with `users`, `tasks`, and `relations` directories
- Human task output includes owner/assignee identifiers and richer task detail

### Removed

- Archive bucket and archive commands; terminal tasks remain in `tasks` and are
  filtered by `status`
- Legacy task fields and flags including `description`, `due`, `startedAt`,
  `completedAt`, `schemaVersion`, and `parentId`
- Legacy config and migration paths such as `--data-dir`,
  `--skip-legacy-check`, and JSON migration helpers

## [0.2.0] - 2026-03-19

### Added

- 1Password secret reference support for PostgreSQL connection strings — store
  `op://vault/item/field` in config or env vars and karya resolves it at runtime
  via `op read`, keeping plaintext credentials off disk
- PostgreSQL SSL/TLS support (`verify-full` default, `off` for local dev)
- Config file permission hardening (0600 on POSIX)
- Connection string redaction in error messages
- Install script (`install.sh`) for `curl | bash` installation via GitHub
  Releases
- GitHub Release now includes npm tarball as a release asset
- Release automation script for versioning, changelog updates, and tarball smoke
  testing
- Homebrew tap notification workflow for published releases
- Main-driven release workflow that publishes automatically when a new version
  lands on `main`

### Removed

- Web UI (`karya serve`) — Hono, HTMX, PicoCSS dependencies removed

### Changed

- npm publish step is gated on `NPM_TOKEN` secret being configured
- `npm pack` now builds distributable artifacts via `prepack`
- CLI now exposes `karya --version`
- CI runs CLI e2e coverage explicitly
- Release preparation now stops at a version-bump commit; CI creates the tag and
  GitHub Release after merge

## [0.1.0] - 2025-05-15

### Added

- CLI task tracker with SQLite backend
- Commands: add, list, show, edit, start, done, cancel, delete, archive,
  export, import, config, serve
- Web UI with Hono + HTMX + PicoCSS
- Optional PostgreSQL backend
- JSON export/import for portability
- Legacy JSON file migration path

[Unreleased]: https://github.com/ealt/karya/compare/v2.0.3...HEAD
[2.0.3]: https://github.com/ealt/karya/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/ealt/karya/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/ealt/karya/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/ealt/karya/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/ealt/karya/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/ealt/karya/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ealt/karya/releases/tag/v0.1.1
[0.1.0]: https://github.com/ealt/karya/releases/tag/v0.1.0
