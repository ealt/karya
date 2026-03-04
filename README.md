# Karya

Git-backed task tracker for orchestrating AI agents across machines.

## Quick Start (Bun First)

```bash
bun install
bun run src/cli/index.ts config init --data-dir ./data --no-sync
bun run src/cli/index.ts add "Ship MVP" -P P1 --data-dir ./data --no-sync
bun run src/cli/index.ts list --data-dir ./data --no-sync
```

Or use the launcher:

```bash
./bin/karya --data-dir ./data --no-sync list
```

`./bin/karya` prefers Bun automatically and falls back to Node + `tsx` when Bun is unavailable.

## Migration From Node Toolchain

Node command:

```bash
npm install
npm run dev -- --help
npm test
npm run lint
```

Bun equivalent:

```bash
bun install
bun run dev -- --help
bun run test
bun run lint
```

Node fallback remains available:

```bash
npm run dev:node -- --help
```

## CLI Commands

```bash
karya add "Title" -p project -P P1 -t tag1,tag2 --due tomorrow
karya list --project foo --priority P0,P1 --status open
karya show <id>
karya edit <id> --priority P0 --note "context"
karya start <id>
karya done <id>
karya cancel <id>
karya delete <id> [--archive]
karya archive list
karya archive restore <id>
karya sync
karya config init
karya config set <key> <value>
karya serve --port 3000
```

Global flags:

```bash
--data-dir <path>
--format human|json
--no-sync
--author <name>
```

## Data Layout

```text
<data-repo>/
  config.json
  tasks/<id>.json
  archive/<id>.json
  projects/<slug>.json
```

## Web UI

```bash
karya serve --data-dir ./data --no-sync
```

- Dashboard with filters
- Task detail/edit panel
- Inline status transitions
- JSON API: `/api/tasks`, `/api/tasks/:id`

## Testing

```bash
bun run test
bun run test:e2e
```
