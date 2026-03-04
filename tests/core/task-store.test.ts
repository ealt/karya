import { afterEach, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../src/core/backends/sqlite.js";
import { KaryaError } from "../../src/core/errors.js";
import { TaskStore } from "../../src/core/task-store.js";

const backends: SqliteBackend[] = [];

async function createStore(): Promise<TaskStore> {
  const backend = new SqliteBackend(":memory:");
  backends.push(backend);
  const store = new TaskStore(backend);
  await store.ensureInitialized();
  return store;
}

afterEach(async () => {
  await Promise.allSettled(backends.splice(0).map((backend) => backend.close()));
});

describe("TaskStore", () => {
  it("adds and lists tasks", async () => {
    const store = await createStore();
    const created = await store.addTask(
      {
        title: "Ship MVP",
        project: "karya",
        priority: "P1",
        tags: ["cli"],
      },
      "cli",
      { project: "inbox", priority: "P2" },
    );

    const listed = await store.listTasks();

    expect(created.id).toHaveLength(8);
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Ship MVP");
  });

  it("archives terminal tasks immediately", async () => {
    const store = await createStore();
    const created = await store.addTask({ title: "Close me" }, "cli", {
      project: "inbox",
      priority: "P2",
    });

    await store.doneTask(created.id, "cli");

    const active = await store.listTasks();
    const archived = await store.listTasks({ includeArchive: true, status: ["done"] });

    expect(active).toHaveLength(0);
    expect(archived.some((task) => task.id === created.id)).toBe(true);
  });

  it("supports prefix lookup with minimum length", async () => {
    const store = await createStore();
    const created = await store.addTask({ title: "Lookup" }, "cli", {
      project: "inbox",
      priority: "P2",
    });

    const found = await store.showTask(created.id.slice(0, 4));
    expect(found.task.id).toBe(created.id);

    await expect(store.showTask(created.id.slice(0, 3))).rejects.toBeInstanceOf(KaryaError);
  });

  it("restores archived tasks", async () => {
    const store = await createStore();
    const created = await store.addTask({ title: "Restore" }, "cli", {
      project: "inbox",
      priority: "P2",
    });

    await store.cancelTask(created.id, "cli");
    const restored = await store.restoreTask(created.id, "cli");

    expect(restored.status).toBe("open");
    const active = await store.listTasks();
    expect(active.map((task) => task.id)).toContain(created.id);
  });
});
