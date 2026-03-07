# Plan: Security Hardening for AWS RDS PostgreSQL

## Context

Karya's PostgreSQL backend will be hosted on AWS RDS, accessed from multiple machines (local laptop agents in Docker sandboxes, host laptop, OpenClaw on a VPS). The current `pg` backend has **zero SSL/TLS configuration** — connections are unencrypted with no certificate verification. The web server has no authentication. Security hardening is urgent.

**Decisions made:**
- Drop the web server entirely (all access via CLI → RDS)
- CLI-direct-to-DB architecture (each client gets PG credentials + SSL)
- Code changes only (AWS infrastructure handled separately)
- Claude Code natural language integration is a separate workstream

---

## Changes

### 1. Add SSL fields to PG backend schema

**File:** `src/core/schema.ts`

Extend the `pg` variant of `BackendConfigSchema` to include:
- `ssl`: `"require" | "verify-full" | "off"` (default: `"require"`)
- `sslCaPath`: optional string (path to CA certificate PEM)

Default is `"require"` — secure by default. `"off"` only for local dev.

### 2. Plumb SSL config through config resolution

**File:** `src/core/config.ts`

- Add `parseSslMode()` helper (same pattern as existing `parseBackendType()`)
- New env vars: `KARYA_PG_SSL` and `KARYA_PG_SSL_CA`
- Update `resolveConfig()` PG branch to resolve and include `ssl` + `sslCaPath`
- Update `ResolveConfigOptions` interface with optional `ssl` and `sslCaPath`
- Add `config set` handlers for `backend.ssl` and `backend.sslCaPath`
- After `writeFile` in `saveAppConfig`, call `chmod(path, 0o600)` to restrict config file permissions

### 3. Update `createPool` with SSL support

**File:** `src/core/backends/pg.ts`

- New `PgSslOptions` interface: `{ mode, caPath? }`
- Update `createPool(connectionString, ssl?)` to build `PoolConfig.ssl` when mode is not `"off"`:
  - `rejectUnauthorized: true` (always, when SSL is on)
  - `ca: await readFile(caPath)` if `caPath` is provided
- Add pool hardening defaults: `max: 5`, `idleTimeoutMillis: 10_000`, `connectionTimeoutMillis: 5_000`
- Wrap the `SELECT 1` health check in try/catch to redact connection strings from error messages

### 4. Wire SSL options through backend factory

**File:** `src/core/create-backend.ts`

Pass `{ mode: config.ssl, caPath: config.sslCaPath }` from resolved config to `createPool`.

### 5. Remove the web server

**Files to delete:**
- `src/web/server.ts`

**Files to modify:**
- `src/cli/index.ts` — remove the `serve` command registration
- `src/cli/commands/serve.ts` — delete
- `package.json` — remove `hono` and `@hono/node-server` dependencies

**Test files to delete/update:**
- Any e2e tests for the web server

### 6. Update tests

**File:** `tests/core/backends/pg.test.ts` (and any related)

- Update tests that call `createPool` to pass SSL options
- Add unit tests for SSL config construction (require mode, verify-full mode, off mode, with CA path)
- Test that config resolution correctly picks up `KARYA_PG_SSL` and `KARYA_PG_SSL_CA` env vars

---

## Implementation Order

1. Schema change (`schema.ts`) — foundation for all other changes
2. Config resolution (`config.ts`) — env vars, `resolveConfig`, `config set`, file permissions
3. Pool creation (`pg.ts`) — SSL support, pool hardening, error redaction
4. Backend factory (`create-backend.ts`) — wire SSL options through
5. Remove web server (`server.ts`, `serve.ts`, `index.ts`, `package.json`)
6. Tests — update existing, add new SSL-related tests

## Verification

1. `npm run build` — confirm TypeScript compiles cleanly
2. `npm test` — all existing tests pass (with web server tests removed)
3. Manual test with local PostgreSQL (SSL off):
   ```
   KARYA_BACKEND=pg KARYA_PG_CONNECTION_STRING="postgresql://localhost/karya" KARYA_PG_SSL=off karya list
   ```
4. Verify `karya serve` is gone (should error as unknown command)
5. Verify config file gets `0600` permissions after `karya config set`
6. Verify connection string is redacted in error messages (point at non-existent host)
