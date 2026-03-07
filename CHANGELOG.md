# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Install script (`install.sh`) for `curl | bash` installation via GitHub
  Releases
- GitHub Release now includes npm tarball as a release asset

### Changed

- npm publish step is gated on `NPM_TOKEN` secret being configured
- PostgreSQL TLS configuration now supports `verify-full` (default) and `off`
  modes with optional CA path support

### Removed

- Web UI server and `karya serve` command
- Web dependencies (`hono`, `@hono/node-server`)

## [0.1.0] - 2025-05-15

### Added

- CLI task tracker with SQLite backend
- Commands: add, list, show, edit, start, done, cancel, delete, archive,
  export, import, config, serve
- Web UI with Hono + HTMX + PicoCSS
- Optional PostgreSQL backend
- JSON export/import for portability
- Legacy JSON file migration path

[Unreleased]: https://github.com/ealt/karya/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ealt/karya/releases/tag/v0.1.0
