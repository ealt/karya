import { describe, expect, it } from "vitest";
import { filterTasks } from "../../src/core/query.js";
import type { Task } from "../../src/core/schema.js";

function makeTask(overrides: Partial<Task>): Task {
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

describe("filterTasks", () => {
  it("filters by project and status", () => {
    const tasks = [
      makeTask({ id: "aaaabbbb", project: "alpha", status: "open" }),
      makeTask({ id: "ccccdddd", project: "beta", status: "done" }),
    ];

    const filtered = filterTasks(tasks, { project: ["alpha"], status: ["open"] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("aaaabbbb");
  });
});
