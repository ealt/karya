# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/ealt/karya/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ealt/karya/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ealt/karya/releases/tag/v0.1.1
[0.1.0]: https://github.com/ealt/karya/releases/tag/v0.1.0
