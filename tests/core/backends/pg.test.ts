import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, PgBackend } from "../../../src/core/backends/pg.js";
import type { Task } from "../../../src/core/schema.js";

const pgUrl = process.env.KARYA_TEST_PG_URL;

function task(overrides: Partial<Task> = {}): Task {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "abcd1234",
    title: overrides.title ?? "Task",
    description: overrides.description ?? "",
    project: overrides.project ?? "inbox",
    tags: overrides.tags ?? [],
    priority: overrides.priority ?? "P2",
    status: overrides.status ?? "open",
    createdAt: overrides.createdAt ?? "2026-03-04T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-04T00:00:00.000Z",
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    dueAt: overrides.dueAt ?? null,
    createdBy: overrides.createdBy ?? "cli",
    updatedBy: overrides.updatedBy ?? "cli",
    parentId: overrides.parentId ?? null,
    notes: overrides.notes ?? [],
    conflicts: overrides.conflicts,
  };
}

const describePg = pgUrl ? describe : describe.skip;

describePg("PgBackend", () => {
  let backend: PgBackend;

  beforeAll(async () => {
    const pool = await createPool(pgUrl as string);
    backend = new PgBackend(pool);
    await backend.initialize();
  });

  afterAll(async () => {
    await backend.close();
  });

  it("stores and retrieves tasks", async () => {
    const id = `pg${Math.random().toString(36).slice(2, 8)}`.slice(0, 8);
    const created = task({ id });

    expect((await backend.putTask(created, "tasks")).written).toBe(true);

    const loaded = await backend.getTask(id, "tasks");
    expect(loaded?.id).toBe(id);

    await backend.deleteTask(id, "tasks");
  });
});
