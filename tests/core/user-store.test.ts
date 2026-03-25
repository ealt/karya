import { afterEach, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../src/core/backends/sqlite.js";
import { KaryaError } from "../../src/core/errors.js";
import { UserStore } from "../../src/core/user-store.js";

const backends: SqliteBackend[] = [];

async function createStore(): Promise<UserStore> {
  const backend = new SqliteBackend(":memory:");
  backends.push(backend);
  const store = new UserStore(backend);
  await store.ensureInitialized();
  return store;
}

afterEach(async () => {
  await Promise.allSettled(backends.splice(0).map((backend) => backend.close()));
});

describe("UserStore", () => {
  it("adds, edits, lists, and deactivates users", async () => {
    const store = await createStore();
    const created = await store.addUser({ name: "Eric Alt", alias: "ealt" });
    const edited = await store.editUser(created.id, { alias: "eric.alt" });
    const listed = await store.listUsers();
    const deactivated = await store.deactivateUser(edited.alias);

    expect(listed.map((user) => user.alias)).toContain("eric.alt");
    expect(deactivated.deactivatedAt).not.toBeNull();
  });

  it("rejects duplicate aliases", async () => {
    const store = await createStore();
    await store.addUser({ name: "Eric Alt", alias: "ealt" });

    await expect(store.addUser({ name: "Another", alias: "ealt" })).rejects.toBeInstanceOf(KaryaError);
  });

  it("requireActiveUser rejects missing or deactivated aliases", async () => {
    const store = await createStore();
    const created = await store.addUser({ name: "fraxl", alias: "fraxl" });
    await store.deactivateUser(created.id);

    await expect(store.requireActiveUser("missing")).rejects.toBeInstanceOf(KaryaError);
    await expect(store.requireActiveUser("fraxl")).rejects.toBeInstanceOf(KaryaError);
  });
});
