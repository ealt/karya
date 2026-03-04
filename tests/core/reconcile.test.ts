import { describe, expect, it } from "vitest";
import { reconcileTasks } from "../../src/core/reconcile.js";
import type { Task } from "../../src/core/schema.js";

function task(overrides: Partial<Task>): Task {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "abcd1234",
    title: overrides.title ?? "task",
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

describe("reconcileTasks", () => {
  it("append-merges notes and captures conflicts", () => {
    const local = task({
      title: "local",
      updatedAt: "2026-03-04T10:00:00.000Z",
      notes: [{ body: "l1", author: "a", timestamp: "2026-03-04T09:00:00.000Z" }],
    });

    const remote = task({
      title: "remote",
      updatedAt: "2026-03-04T09:00:00.000Z",
      notes: [{ body: "r1", author: "b", timestamp: "2026-03-04T08:00:00.000Z" }],
    });

    const merged = reconcileTasks(local, remote);
    expect(merged.title).toBe("local");
    expect(merged.notes.map((note) => note.body)).toEqual(["r1", "l1"]);
    expect((merged.conflicts ?? []).length).toBeGreaterThan(0);
  });
});
