import { afterEach, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../src/core/backends/sqlite.js";
import { KaryaError } from "../../src/core/errors.js";
import { TaskStore } from "../../src/core/task-store.js";
import { UserStore } from "../../src/core/user-store.js";

const backends: SqliteBackend[] = [];

async function createStores() {
  const backend = new SqliteBackend(":memory:");
  backends.push(backend);
  const taskStore = new TaskStore(backend);
  const userStore = new UserStore(backend);
  await taskStore.ensureInitialized();
  const user = await userStore.addUser({ name: "Eric Alt", alias: "ealt" });
  const agent = await userStore.addUser({ name: "fraxl", alias: "fraxl", type: "agent" });
  return { taskStore, userStore, user, agent };
}

afterEach(async () => {
  await Promise.allSettled(backends.splice(0).map((backend) => backend.close()));
});

describe("TaskStore", () => {
  it("adds and lists tasks with normalized fields", async () => {
    const { taskStore, user, agent } = await createStores();
    const created = await taskStore.addTask(
      {
        title: "Ship MVP",
        project: "karya",
        priority: "P1",
        tags: ["cli"],
        note: "initial context",
        ownerId: user.id,
        assigneeId: agent.id,
      },
      user.id,
      { project: "inbox", priority: "P2" },
    );

    const listed = await taskStore.listTasks({ assigneeType: "agent" });

    expect(created.id).toHaveLength(8);
    expect(created.note).toBe("initial context");
    expect(listed.map((task) => task.id)).toContain(created.id);
  });

  it("supports edit status and surgical tag operations", async () => {
    const { taskStore, user } = await createStores();
    const created = await taskStore.addTask({ title: "Edit me" }, user.id, { project: "inbox", priority: "P2" });

    const updated = await taskStore.editTask(
      created.id,
      {
        status: "done",
        addTags: ["cli"],
        editTags: ["size:large"],
        note: "updated context",
      },
      user.id,
    );

    expect(updated.status).toBe("done");
    expect(updated.tags).toContain("cli");
    expect(updated.tags).toContain("size:large");
    expect(updated.note).toBe("updated context");
  });

  it("supports relations and rejects parent cycles", async () => {
    const { taskStore, user } = await createStores();
    const parent = await taskStore.addTask({ title: "Parent" }, user.id, { project: "inbox", priority: "P2" });
    const child = await taskStore.addTask({ title: "Child", parentId: parent.id }, user.id, {
      project: "inbox",
      priority: "P2",
    });

    await expect(taskStore.addRelation(parent.id, child.id, "parent")).rejects.toBeInstanceOf(KaryaError);
    const detail = await taskStore.showTask(child.id);
    expect(detail.relations.some((relation) => relation.type === "parent" && relation.targetId === parent.id)).toBe(true);
  });

  it("rejects deactivated assignees", async () => {
    const { taskStore, userStore, user, agent } = await createStores();
    await userStore.deactivateUser(agent.id);

    await expect(
      taskStore.addTask({ title: "Nope", assigneeId: agent.id }, user.id, { project: "inbox", priority: "P2" }),
    ).rejects.toBeInstanceOf(KaryaError);
  });

  it("supports prefix lookup with minimum length", async () => {
    const { taskStore, user } = await createStores();
    const created = await taskStore.addTask({ title: "Lookup" }, user.id, { project: "inbox", priority: "P2" });

    const found = await taskStore.showTask(created.id.slice(0, 4));
    expect(found.task.id).toBe(created.id);

    await expect(taskStore.showTask(created.id.slice(0, 3))).rejects.toBeInstanceOf(KaryaError);
  });
});
