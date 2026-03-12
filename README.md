# Karya

> *Sanskrit: "what ought to be done"*

SQL-backed task tracker for orchestrating AI agents across machines. CLI-first,
portable via JSON export/import, with SQLite local storage and optional
PostgreSQL backend.

## Install

```bash
brew install ealt/tap/karya
```

Alternative:

```bash
curl -fsSL https://raw.githubusercontent.com/ealt/karya/main/install.sh | bash
```

npm publishing is reserved for a future release path.

Then initialize a local database and start working:

```bash
karya config init
karya add "Ship MVP" -P P1
karya list
```

### From source

```bash
git clone https://github.com/ealt/karya.git
cd karya
bun install && bun link
```

## CLI commands

```bash
karya add "Title" -p project -P P1 -t tag1,tag2 --due tomorrow
karya list --project foo --priority P0,P1 --status open
karya show <id>
karya edit <id> --priority P0 --note "context"
karya start <id>
karya done <id>
karya cancel <id>
karya delete <id>
karya archive list
karya archive restore <id>
karya export --output ./backup
karya import --input ./backup
karya config init
karya config set <key> <value>
```

Global flags: `--db-path <path>`, `--format human|json`, `--author <name>`,
`--skip-legacy-check`

Legacy compatibility flag: `--data-dir <path>` maps to `<path>/karya.db`.

All commands support `--format json` for programmatic use. Partial ID prefix
matching requires at least 4 characters.

## Configuration

Resolution order: CLI flags > env vars > app config > defaults.

| Source | Location |
|---|---|
| App config | `~/.config/karya/karya.json` |
| Env vars | `KARYA_BACKEND`, `KARYA_DB_PATH`, `KARYA_DATA_DIR`, `KARYA_PG_CONNECTION_STRING`, `KARYA_PG_SSL`, `KARYA_PG_SSL_CA`, `KARYA_AUTHOR`, `KARYA_FORMAT`, `KARYA_SKIP_LEGACY_CHECK` |

`karya config set` supports:
- `author`
- `defaultProject`
- `defaultPriority`
- `backend.type` (`sqlite` or `pg`)
- `backend.dbPath`
- `backend.connectionString`
- `backend.ssl` (`verify-full` or `off`, pg backend only)
- `backend.sslCaPath` (pg backend only)

### PostgreSQL TLS

- Default mode is `verify-full` (certificate verification enabled)
- Local development can use `off`
- Invalid `KARYA_PG_SSL` values fail fast
- `backend.sslCaPath` and `KARYA_PG_SSL_CA` support `~/...` expansion

## Legacy JSON migration

This version no longer uses file-per-task storage directly. Export/import is the
interop path:

```bash
karya --db-path ./karya.db --skip-legacy-check import --input <old-data-dir>
karya --db-path ./karya.db export --output ./backup
```

## Development

```bash
bun install
bun run dev -- --help
bun run build
bun run test
bun run test:e2e
bun run lint
```

Node fallback: `bun run dev:node -- --help`
