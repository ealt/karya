# Fix: pg driver returns Date objects but Zod expects strings

## Context

The `pg` npm package automatically converts PostgreSQL `TIMESTAMPTZ` columns to JavaScript `Date` objects. The Zod schemas in `schema.ts` use `z.string().datetime()` for timestamp fields (`createdAt`, `deactivatedAt`, `openedAt`, `closedAt`), which rejects `Date` objects at parse time. This causes runtime failures when reading existing records from PostgreSQL — specifically v1 migration users with `TIMESTAMPTZ` values.

SQLite is unaffected because it stores timestamps as `TEXT` and returns strings.

## Approach

Fix the pg backend's row-parsing functions to normalize `Date` objects to ISO strings before passing them to Zod. This keeps the schema contract clean (always strings) and confines the fix to where the mismatch originates.

### Changes

**1. `src/core/backends/pg.ts`**

- Update `UserRow` and `TaskRow` interfaces: change timestamp fields from `string` to `string | Date` to reflect what `pg` actually returns
- Add a small inline helper to normalize timestamps:
  ```ts
  function toIso(value: string | Date | null): string | null {
    if (value == null) return null;
    return value instanceof Date ? value.toISOString() : value;
  }
  ```
  (Non-nullable variant for required fields, or just use `as string` after the call)
- Apply `toIso()` in `parseUserRow` for `created_at` and `deactivated_at`
- Apply `toIso()` in `parseTaskRow` for `opened_at` and `closed_at`

**2. `tests/core/backends/pg.test.ts`**

Add a new `describe` block (outside the integration `describePg` block) using a mocked pool — same pattern as `pg-pool.test.ts`. The mock pool's `query` returns rows with `Date` objects in timestamp columns, simulating what the real `pg` driver does for `TIMESTAMPTZ`.

Tests to add:
- **`getUser` returns normalized ISO strings when pg returns Date objects** — mock `pool.query` to return a user row where `created_at` is `new Date("2026-03-25T00:00:00.000Z")` and `deactivated_at` is `null`. Call `backend.users.getUser(id)`. Assert `result.createdAt` is `"2026-03-25T00:00:00.000Z"` (string).
- **`getAllUsers` normalizes Date timestamps** — mock to return multiple user rows with Date timestamps. Call `backend.users.getAllUsers()`. Assert all returned users have string `createdAt`.
- **`getTask` returns normalized ISO strings when pg returns Date objects** — mock a task row where `opened_at` is a `Date` and `closed_at` is a `Date`. Assert both come back as ISO strings.
- **`getTask` handles null closed_at with Date opened_at** — mock a task row where `opened_at` is a `Date` and `closed_at` is `null`. Assert `openedAt` is an ISO string and `closedAt` is `null`.

### Files to modify

- `/fix__timestamp-bug-sandbox/src/core/backends/pg.ts` (lines 12-19, 21-32, 45-54, 56-69)
- `/fix__timestamp-bug-sandbox/tests/core/backends/pg.test.ts` (add mocked-pool tests)

### What stays the same

- `src/core/schema.ts` — no changes; `z.string().datetime()` is the correct contract
- `src/core/backends/sqlite.ts` — unaffected; timestamps are already strings
- `src/core/dates.ts` — unchanged
- Test factories — unchanged

## Verification

1. `bun run lint` — type-check passes
2. `bun run test` — all existing + new tests pass (new tests run without a real PG connection)
