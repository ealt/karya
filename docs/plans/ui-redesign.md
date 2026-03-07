# Plan: Security Hardening for AWS RDS PostgreSQL

## Context

Karya's PostgreSQL backend will be hosted on AWS RDS, accessed from multiple machines (local laptop agents in Docker sandboxes, host laptop, OpenClaw on a VPS). The current `pg` backend has **zero SSL/TLS configuration** — connections are unencrypted with no certificate verification. The web server has no authentication and is being permanently removed. Security hardening is urgent.

**Decisions:**
- Two SSL modes only: `verify-full` (default) and `off` (local dev)
- Invalid `KARYA_PG_SSL` values hard-fail
- Web server permanently removed (all code, config, deps, docs)
- `sslCaPath` supports `~` expansion (like `dbPath` does via `expandHome()`)
- `chmod 0600` on config file is POSIX-only with try/catch (no-op on Windows)

### SSL Decision Table

| Mode          | Encrypted | Cert verified | `pg` PoolConfig                  | Use case    |
|---------------|-----------|---------------|----------------------------------|-------------|
| `verify-full` | Yes       | Yes           | `ssl: { rejectUnauthorized: true, ca? }` | Production  |
| `off`         | No        | No            | `ssl: false`                     | Local dev   |

---

## Changes

### 1. Add SSL fields to PG backend schema

**File:** `src/core/schema.ts`

Extend the `pg` variant of `BackendConfigSchema` (line 52-55):
```typescript
z.object({
  type: z.literal("pg"),
  connectionString: z.string().min(1),
  ssl: z.enum(["verify-full", "off"]).default("verify-full"),
  sslCaPath: z.string().optional(),
})
```

Remove `web` from `AppConfigSchema` (line 63-65) — the entire `web` field and `DEFAULT_WEB_PORT` import.

Remove `DEFAULT_WEB_PORT` from `src/shared/constants.ts` (line 5).

### 2. Plumb SSL config through config resolution

**File:** `src/core/config.ts`

- Add `parseSslMode()` helper (same pattern as `parseBackendType()` at line 55-61) — but **hard-fail** on unrecognized values: throw `KaryaError("Invalid KARYA_PG_SSL value: ...", "CONFIG")` instead of returning `undefined`.
- New env vars: `KARYA_PG_SSL`, `KARYA_PG_SSL_CA`
- Update `ResolveConfigOptions` with optional `ssl` and `sslCaPath`
- Update `resolveConfig()` PG branch (line 245-258) to resolve SSL:
  ```
  ssl: options.ssl ?? parseSslMode(env.KARYA_PG_SSL) ?? appConfig.backend.ssl ?? "verify-full"
  sslCaPath: options.sslCaPath ?? env.KARYA_PG_SSL_CA ?? appConfig.backend.sslCaPath
  ```
  Apply `expandHome()` to `sslCaPath` (reuse existing helper at line 32-36).
- Add `config set` handlers for `backend.ssl` and `backend.sslCaPath`. If the current backend is `sqlite`, these commands should throw `KaryaError("backend.ssl only applies to pg backend; set backend.connectionString first", "CONFIG")` — same pattern as the existing `backend.type=pg` guard at line 186-188.
- Remove `webPort` from `ResolvedConfig` interface (line 25) and all `web`-related config: `DEFAULT_APP_CONFIG.web`, the `web` merge logic in `loadAppConfig`/`saveAppConfig`, and the `config set` handler for `web.port` (line 156-163).
- In `saveAppConfig` (line 150), after `writeFile`, add POSIX-only chmod:
  ```typescript
  try { await chmod(path, 0o600); } catch {}
  ```

### 3. Update `createPool` with SSL support

**File:** `src/core/backends/pg.ts`

- New interface:
  ```typescript
  export interface PgSslOptions {
    mode: "verify-full" | "off";
    caPath?: string;
  }
  ```
- Update signature: `createPool(connectionString: string, ssl?: PgSslOptions)`
- Build `PoolConfig.ssl` when mode is not `"off"`:
  - `rejectUnauthorized: true` (always)
  - `ca: await readFile(caPath)` if `caPath` is provided
- Pool hardening: `max: 5`, `idleTimeoutMillis: 10_000`, `connectionTimeoutMillis: 5_000`
- Wrap `SELECT 1` in try/catch, redact connection strings from error:
  ```typescript
  throw new KaryaError(
    `Failed to connect to PostgreSQL: ${message.replace(/postgresql?:\/\/[^\s]+/gi, "postgresql://***")}`,
    "CONFIG"
  );
  ```

### 4. Wire SSL through backend factory

**File:** `src/core/create-backend.ts`

Change line 17 from:
```typescript
const pool = await createPool(config.connectionString);
```
to:
```typescript
const pool = await createPool(config.connectionString, {
  mode: config.ssl,
  caPath: config.sslCaPath,
});
```

### 5. Permanently remove web server

**Files to delete:**
- `src/web/server.ts`
- `src/cli/commands/serve.ts`

**Files to modify:**

`src/cli/commands/index.ts` — Remove `registerServeCommand` import (line 11) and call (line 28).

`src/cli/shared/runtime.ts` — Remove the `commandName` helper (lines 167-179) and the `commandName(commandLike) !== "serve"` guard in the `finally` block (line 218). After removal, the `finally` block should unconditionally call `backend.close()`:
```typescript
finally {
  if (backend) {
    await backend.close();
  }
}
```

`src/shared/constants.ts` — Remove `DEFAULT_WEB_PORT` (line 5).

`package.json` — Remove `hono` and `@hono/node-server` from dependencies.

`README.md` — Remove the `karya serve --port 3000` line (line 54), the "Web UI" section (lines 84-91), and update the description if it mentions web UI.

`AGENTS.md` — Remove any references to the web server or `serve` command.

`docs/plans/sql-refactor.md` — Update or add a note that the web server has been removed (resolves cross-plan conflict).

### 6. Tests

Update existing tests to account for changes:
- Delete `tests/e2e/web.e2e.test.ts` (web server removed)
- Update PG backend tests to pass SSL options to `createPool`

Add new tests:
- SSL config construction (verify-full with/without CA, off mode)
- `parseSslMode` hard-fails on invalid values
- Config resolution picks up `KARYA_PG_SSL` and `KARYA_PG_SSL_CA` env vars
- `karya serve` is no longer a registered command

---

## Implementation Order

1. **Schema** (`schema.ts`, `constants.ts`) — Add SSL fields, remove web config
2. **Config** (`config.ts`) — SSL env vars, resolution, `config set`, chmod, remove web config
3. **Pool** (`pg.ts`) — SSL support, pool hardening, error redaction
4. **Factory** (`create-backend.ts`) — Wire SSL options
5. **Web removal** (`serve.ts`, `server.ts`, `index.ts`, `runtime.ts`, `package.json`)
6. **Docs** (`README.md`, `AGENTS.md`, `docs/plans/sql-refactor.md`)

## Verification

1. `bun run build` — TypeScript compiles cleanly
2. `bun run test` — Vitest tests pass
3. `bun run test:e2e` — E2e tests pass (with `web.e2e.test.ts` deleted)
4. Manual: confirm `karya serve` errors as unknown command
5. Manual: config file gets `0600` permissions after `karya config set backend.ssl verify-full`
6. Manual: `KARYA_PG_SSL=banana karya list` hard-fails with clear error message
7. Manual: `karya config set backend.ssl verify-full` while backend is sqlite → clear error
8. Manual: connection string redacted in error output (point at non-existent PG host)
9. Manual with local PG (SSL off):
   ```bash
   KARYA_BACKEND=pg KARYA_PG_CONNECTION_STRING="postgresql://localhost/karya" KARYA_PG_SSL=off karya config init
   KARYA_BACKEND=pg KARYA_PG_CONNECTION_STRING="postgresql://localhost/karya" KARYA_PG_SSL=off karya list
   ```
