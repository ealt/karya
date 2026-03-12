# Contributing to Karya

## Setup

```bash
git clone <repo-url>
cd karya
bun install
bun link       # Makes `karya` available as a global command
```

Requires [Bun](https://bun.sh/) v1.2.5+. Node.js 22+ works as a fallback
(`npm install` + `npm run dev:node`), but `bun link` requires Bun.

## Development workflow

```bash
karya <command>             # Run via global link
bun run dev -- <command>    # Run without linking
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

## Releasing

Create a release from a clean `main` checkout:

```bash
npm run release -- patch
```

The release script runs local validation, bumps the version, moves
`CHANGELOG.md` entries out of `[Unreleased]`, smoke-tests the packaged tarball,
then creates the release commit and annotated tag. Push the branch and tag when
prompted, or set `PUSH=1` to push automatically.

After the tag is pushed, GitHub Actions publishes the tarball and checksum to a
GitHub Release. If `NPM_TOKEN` is configured, the same workflow can also publish
to npm. A separate workflow notifies `ealt/homebrew-tap` when the release is
published.

## Code conventions

- TypeScript strict mode
- ES2022 target with NodeNext module resolution
- All imports use `.js` extensions
- Zod schemas in `src/core/schema.ts` are the source of truth for types
- One file per CLI command in `src/cli/commands/`
- Tests mirror the `src/` directory structure under `tests/`

## Testing

- Unit tests: `tests/core/` — test domain logic in isolation
- E2E tests: `tests/e2e/` — test CLI commands end-to-end
- Test runner: Vitest (not Bun's built-in runner)

To run a specific test file:

```bash
bun run test -- tests/core/schema.test.ts
```
