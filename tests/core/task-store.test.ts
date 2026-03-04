import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../../src/core/task-store.js";
import { KaryaError } from "../../src/core/errors.js";

const dirs: string[] = [];

async function createStore(): Promise<TaskStore> {
  const dir = await mkdtemp(join(tmpdir(), "karya-test-"));
  dirs.push(dir);
  const store = new TaskStore(dir);
  await store.ensureInitialized();
  return store;
}

afterEach(async () => {
  await Promise.allSettled(
    dirs.splice(0).map(async (dir) => {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }),
  );
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
