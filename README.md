# Karya

> *Sanskrit: "what ought to be done"*

Git-backed task tracker for orchestrating AI agents across machines. CLI-first,
offline-resilient, syncs via git. One JSON file per task to minimize merge
conflicts when multiple agents write concurrently.

## Quick start

```bash
bun install
bun link                # Makes `karya` available globally
karya config init --data-dir ./data --no-sync
karya add "Ship MVP" -P P1 --data-dir ./data --no-sync
karya list --data-dir ./data --no-sync
```

If you prefer not to link globally, use the launcher directly:

```bash
./bin/karya list --data-dir ./data --no-sync
```

`./bin/karya` auto-detects Bun and falls back to Node + tsx.

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
karya sync
karya config init
karya config set <key> <value>
karya serve --port 3000
```

Global flags: `--data-dir <path>`, `--format human|json`, `--no-sync`,
`--author <name>`

All commands support `--format json` for programmatic/agent consumption.
Partial ID prefix matching (min 4 chars).

## Data layout

```text
<data-repo>/
  config.json            # Repo-level defaults
  tasks/<id>.json        # Active tasks (8-char nanoid IDs)
  archive/<id>.json      # Completed/cancelled tasks
  projects/<slug>.json   # Project metadata
```

## Configuration

Resolution order: CLI flags > env vars > app config > repo config > defaults.

| Source | Location |
|---|---|
| App config | `~/.config/karya/karya.json` |
| Repo config | `<data-dir>/config.json` |
| Env vars | `KARYA_DATA_DIR`, `KARYA_AUTHOR`, `KARYA_NO_SYNC`, `KARYA_FORMAT` |

## Web UI

```bash
karya serve --data-dir ./data --no-sync
```

Dashboard with filters, task detail/edit panel, inline status transitions.
Uses Hono + HTMX + PicoCSS.

JSON API available at `/api/tasks` and `/api/tasks/:id`.

## Development

```bash
bun install              # Install dependencies
bun run dev -- --help    # Run CLI in dev mode
bun run build            # Compile TypeScript
bun run test             # Unit tests (Vitest)
bun run test:e2e         # End-to-end tests
bun run lint             # Type-check (tsc --noEmit)
```

Node fallback: `npm run dev:node -- --help`

For architecture details and coding patterns, see [AGENTS.md](./AGENTS.md).
