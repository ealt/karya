# Karya

> *Sanskrit: "what ought to be done"*

SQL-backed task tracker for orchestrating AI agents across machines. CLI-first,
portable via JSON export/import, with SQLite local storage and optional
PostgreSQL backend.

## Quick start

```bash
bun install
bun link
karya --db-path ./karya.db config init
karya --db-path ./karya.db add "Ship MVP" -P P1
karya --db-path ./karya.db list
```

If you prefer not to link globally, use the launcher directly:

```bash
./bin/karya --db-path ./karya.db list
```

`./bin/karya` runs `dist/` when built, otherwise falls back to Bun or Node+tsx
for source execution.

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
karya serve --port 3000
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
| Env vars | `KARYA_BACKEND`, `KARYA_DB_PATH`, `KARYA_PG_CONNECTION_STRING`, `KARYA_AUTHOR`, `KARYA_FORMAT` |

## Legacy JSON migration

This version no longer uses file-per-task storage directly. Export/import is the
interop path:

```bash
karya --db-path ./karya.db --skip-legacy-check import --input <old-data-dir>
karya --db-path ./karya.db export --output ./backup
```

## Web UI

```bash
karya --db-path ./karya.db serve
```

Dashboard with filters, task detail/edit panel, and inline status transitions.
Uses Hono + HTMX + PicoCSS. JSON API is available at `/api/tasks`.

## Development

```bash
bun install
bun run dev -- --help
bun run build
bun run test
bun run test:e2e
bun run lint
```

Node fallback: `npm run dev:node -- --help`
