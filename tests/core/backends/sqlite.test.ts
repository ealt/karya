import { afterEach, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../../src/core/backends/sqlite.js";
import type { Task } from "../../../src/core/schema.js";

const backends: SqliteBackend[] = [];

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

async function createBackend(): Promise<SqliteBackend> {
  const backend = new SqliteBackend(":memory:");
  await backend.initialize();
  backends.push(backend);
  return backend;
}

afterEach(async () => {
  await Promise.allSettled(backends.splice(0).map((backend) => backend.close()));
});

describe("SqliteBackend", () => {
  it("supports CRUD and prefix lookup", async () => {
    const backend = await createBackend();
    const first = task({ id: "abcd1234" });
    const second = task({ id: "abef5678" });

    expect((await backend.putTask(first, "tasks")).written).toBe(true);
    expect((await backend.putTask(second, "archive")).written).toBe(true);

    const found = await backend.getTask(first.id, "tasks");
    expect(found?.id).toBe(first.id);

    const prefix = await backend.findByPrefix("abc", "tasks");
    expect(prefix.map((item) => item.id)).toEqual(["abcd1234"]);

    await backend.moveTask(first, "tasks", "archive");
    expect(await backend.getTask(first.id, "tasks")).toBeNull();
    expect(await backend.getTask(first.id, "archive")).not.toBeNull();

    await backend.deleteTask(first.id, "archive");
    expect(await backend.getTask(first.id, "archive")).toBeNull();
  });

  it("returns written=false when row is newer", async () => {
    const backend = await createBackend();
    const newer = task({ id: "zxyw9876", updatedAt: "2026-03-04T11:00:00.000Z" });
    const older = task({ id: "zxyw9876", updatedAt: "2026-03-04T10:00:00.000Z" });

    expect((await backend.putTask(newer, "tasks")).written).toBe(true);
    expect((await backend.putTask(older, "tasks")).written).toBe(false);

    const saved = await backend.getTask("zxyw9876", "tasks");
    expect(saved?.updatedAt).toBe("2026-03-04T11:00:00.000Z");
  });
});
