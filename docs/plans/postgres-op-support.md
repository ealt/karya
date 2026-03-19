# Plan: 1Password (`op://`) support for PostgreSQL connection strings

## Context

The PostgreSQL connection string is currently stored either as plaintext in `~/.config/karya/karya.json`, as an environment variable, or passed via CLI flags. The user wants to store it in 1Password instead and reference it via `op://vault/item/field` syntax. The 1Password CLI (`op read <ref>`) resolves these references to their secret values at runtime.

## Approach

Add transparent `op://` resolution in `resolveConfig()` — the single choke point where all connection string sources converge. The `op://` reference is stored as-is in config; resolution happens at runtime only, so the plaintext secret never touches disk.

## Changes

### 1. Create `src/core/op-resolve.ts`

New module with two exports:

- **`isOpReference(value: string): boolean`** — returns `true` if string starts with `op://`
- **`resolveOpReference(reference: string): Promise<string>`** — runs `op read <reference>` via `execFile` (no shell, prevents injection), returns resolved value with trailing newline trimmed

Error handling:
- `ENOENT` → clear message that `op` CLI is not installed, with install link
- Other failures → wraps `op` stderr in a `KaryaError("CONFIG")`
- Empty resolved value → explicit error (likely misconfigured reference)
- 30-second timeout (allows time for biometric/browser auth prompts)

### 2. Modify `src/core/config.ts` (3-line insertion + const→let)

After the connection string is determined (line ~292-299) but before building the backend config:

```typescript
import { isOpReference, resolveOpReference } from "./op-resolve.js";

// Change `const connectionString` to `let connectionString`, then after the empty check:
if (isOpReference(connectionString)) {
  connectionString = await resolveOpReference(connectionString);
}
```

Zero overhead for non-`op://` strings (just a `startsWith` check).

### 3. Create `tests/core/op-resolve.test.ts`

Unit tests mocking `node:child_process` using the `vi.hoisted` + `vi.mock` pattern (matches `pg-pool.test.ts`):

- `isOpReference` — true for `op://...`, false for `postgresql://...` and empty
- Successful resolution — mock `execFile` callback with stdout, verify trimming
- `ENOENT` — verify "not installed" error message
- Auth/other failure — verify stderr included in error
- Empty resolved value — verify explicit error

### 4. Modify `tests/core/config.test.ts`

Add `vi` import, mock `../../src/core/op-resolve.js`, add new `describe` block:

- `op://` from env var → resolves and returns real connection string
- Regular `postgresql://` string → `resolveOpReference` never called
- `op://` from app config file → resolves correctly
- Resolution failure → `KaryaError` propagated

## Files

| File | Action |
|------|--------|
| `src/core/op-resolve.ts` | Create |
| `src/core/config.ts` | Modify (add import + 3 lines) |
| `tests/core/op-resolve.test.ts` | Create |
| `tests/core/config.test.ts` | Modify (add mock + test block) |

No changes to: `schema.ts`, `pg.ts`, `create-backend.ts`, or any other file.

## Key design decisions

- **Resolution at config boundary**: Downstream code (`createPool`, `PgBackend`) receives a plain connection string — no 1Password awareness needed anywhere else
- **`op://` stored as-is in config**: The secret never hits disk; `karya config set backend.connectionString "op://vault/item/field"` just works
- **`execFile` not `exec`**: No shell spawned, reference string safe from injection
- **Single resolution, no recursion**: Resolved once; no chaining

## Verification

```bash
bun run lint           # type-check passes
bun run test           # all unit tests pass (including new ones)

# Manual smoke test (requires op CLI + 1Password):
karya config set backend.connectionString "op://vault/item/field"
karya list             # should resolve and connect
```
