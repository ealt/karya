# Contributing to Karya

## Setup

```bash
git clone <repo-url>
cd karya
bun install
```

Requires [Bun](https://bun.sh/) v1.2.5+. Node.js 22+ works as a fallback
(`npm install` + `npm run dev:node`).

## Development workflow

```bash
bun run dev -- <command>    # Run CLI during development
bun run test                # Run unit tests
bun run test:e2e            # Run end-to-end tests
bun run lint                # Type-check with tsc
bun run build               # Compile to dist/
```

## Project structure

See [AGENTS.md](./AGENTS.md) for full architecture, source layout, and coding
patterns.

## Making changes

1. Create a feature branch from `main`
2. Make changes following existing patterns
3. Ensure `bun run lint` and `bun run test` pass
4. Submit a pull request

## Code conventions

- TypeScript strict mode
- ES2022 target with NodeNext module resolution
- All imports use `.js` extensions
- Zod schemas in `src/core/schema.ts` are the source of truth for types
- One file per CLI command in `src/cli/commands/`
- Tests mirror the `src/` directory structure under `tests/`

## Testing

- Unit tests: `tests/core/` — test domain logic in isolation
- E2E tests: `tests/e2e/` — test CLI commands and web server end-to-end
- Test runner: Vitest (not Bun's built-in runner)

To run a specific test file:

```bash
bun run test -- tests/core/schema.test.ts
```
