import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPool, PgBackend } from "../../../src/core/backends/pg.js";
import { SCHEMA_VERSION } from "../../../src/shared/constants.js";
import { makeTask, makeUser } from "../../helpers/factories.js";

const pgUrl = process.env.KARYA_TEST_PG_URL;
const pgSslMode = process.env.KARYA_TEST_PG_SSL === "verify-full" ? "verify-full" : "off";
const pgSslCaPath = process.env.KARYA_TEST_PG_SSL_CA;

const describePg = pgUrl ? describe : describe.skip;

function makeMockPool() {
  return {
    query: vi.fn(),
    end: vi.fn(async () => undefined),
  } satisfies Pick<Pool, "query" | "end">;
}

describe("PgBackend row parsing", () => {
  it("normalizes Date timestamps in getUser", async () => {
    const pool = makeMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "user1234",
          name: "Eric Alt",
          alias: "ealt",
          type: "human",
          created_at: new Date("2026-03-25T00:00:00.000Z"),
          deactivated_at: null,
        },
      ],
    });
    const backend = new PgBackend(pool as unknown as Pool);

    const user = await backend.users.getUser("user1234");

    expect(user).toMatchObject({
      id: "user1234",
      createdAt: "2026-03-25T00:00:00.000Z",
      deactivatedAt: null,
    });
    expect(typeof user?.createdAt).toBe("string");
  });

  it("normalizes Date timestamps in getAllUsers", async () => {
    const pool = makeMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "user1234",
          name: "Eric Alt",
          alias: "ealt",
          type: "human",
          created_at: new Date("2026-03-25T00:00:00.000Z"),
          deactivated_at: null,
        },
        {
          id: "agent123",
          name: "Planner",
          alias: "planner",
          type: "agent",
          created_at: new Date("2026-03-25T01:00:00.000Z"),
          deactivated_at: new Date("2026-03-25T02:00:00.000Z"),
        },
      ],
    });
    const backend = new PgBackend(pool as unknown as Pool);

    const users = await backend.users.getAllUsers();

    expect(users).toHaveLength(2);
    expect(users).toMatchObject([
      {
        id: "user1234",
        createdAt: "2026-03-25T00:00:00.000Z",
        deactivatedAt: null,
      },
      {
        id: "agent123",
        createdAt: "2026-03-25T01:00:00.000Z",
        deactivatedAt: "2026-03-25T02:00:00.000Z",
      },
    ]);
    expect(users.every((user) => typeof user.createdAt === "string")).toBe(true);
  });

  it("normalizes Date timestamps in getTask", async () => {
    const pool = makeMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "task1234",
          title: "Fix timestamp parsing",
          project: "inbox",
          priority: "P2",
          note: null,
          owner_id: null,
          assignee_id: null,
          tags: ["pg"],
          opened_at: new Date("2026-03-25T00:00:00.000Z"),
          closed_at: new Date("2026-03-25T01:00:00.000Z"),
        },
      ],
    });
    const backend = new PgBackend(pool as unknown as Pool);

    const task = await backend.tasks.getTask("task1234");

    expect(task).toMatchObject({
      id: "task1234",
      openedAt: "2026-03-25T00:00:00.000Z",
      closedAt: "2026-03-25T01:00:00.000Z",
    });
    expect(typeof task?.openedAt).toBe("string");
    expect(typeof task?.closedAt).toBe("string");
  });

  it("preserves null closedAt when getTask receives a Date opened_at", async () => {
    const pool = makeMockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: "task5678",
          title: "Open task",
          project: "inbox",
          priority: "P2",
          note: null,
          owner_id: null,
          assignee_id: null,
          tags: [],
          opened_at: new Date("2026-03-25T00:00:00.000Z"),
          closed_at: null,
        },
      ],
    });
    const backend = new PgBackend(pool as unknown as Pool);

    const task = await backend.tasks.getTask("task5678");

    expect(task).toMatchObject({
      id: "task5678",
      openedAt: "2026-03-25T00:00:00.000Z",
      closedAt: null,
    });
    expect(typeof task?.openedAt).toBe("string");
  });
});

describe("PgBackend.initialize", () => {
  it("skips DDL when schema version matches", async () => {
    const pool = makeMockPool();

    // information_schema.tables query — karya_meta exists
    pool.query.mockResolvedValueOnce({
      rows: [{ table_name: "karya_meta" }, { table_name: "users" }, { table_name: "tasks" }, { table_name: "task_relations" }],
    });
    // schema_version query
    pool.query.mockResolvedValueOnce({
      rows: [{ value: String(SCHEMA_VERSION) }],
    });

    const backend = new PgBackend(pool as unknown as Pool);
    await backend.initialize();

    // Only the two SELECT queries should have been issued — no DDL
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("runs DDL when no tables exist", async () => {
    const pool = makeMockPool();

    // information_schema.tables query — empty database
    pool.query.mockResolvedValueOnce({ rows: [] });
    // All subsequent DDL calls succeed
    pool.query.mockResolvedValue({ rows: [] });

    const backend = new PgBackend(pool as unknown as Pool);
    await backend.initialize();

    // First SELECT + createSchema DDL calls
    expect(pool.query.mock.calls.length).toBeGreaterThan(2);
  });
});

describePg("PgBackend", () => {
  let backend: PgBackend;

  beforeAll(async () => {
    const pool = await createPool(pgUrl as string, {
      mode: pgSslMode,
      caPath: pgSslCaPath,
    });
    backend = new PgBackend(pool);
    await backend.initialize();
  });

  afterAll(async () => {
    await backend.close();
  });

  it("stores and retrieves tasks", async () => {
    const user = makeUser({
      id: `u${Math.random().toString(36).slice(2, 8)}`.slice(0, 8),
      alias: `u${Math.random().toString(36).slice(2, 8)}`,
    });
    const id = `pg${Math.random().toString(36).slice(2, 8)}`.slice(0, 8);
    const created = makeTask({ id });

    await backend.users.putUser(user);
    expect((await backend.tasks.putTask(created)).written).toBe(true);
    expect((await backend.tasks.getTask(id))?.id).toBe(id);

    await backend.tasks.deleteTask(id);
  });
});
