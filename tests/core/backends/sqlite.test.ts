import Database from "better-sqlite3";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../../src/core/backends/sqlite.js";
import { KaryaError } from "../../../src/core/errors.js";
import { makeRelation, makeTask, makeUser } from "../../helpers/factories.js";

const backends: SqliteBackend[] = [];

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
  it("supports users, tasks, relations, and prefix lookup", async () => {
    const backend = await createBackend();
    const user = makeUser();
    const first = makeTask({ id: "abcd1234" });
    const second = makeTask({ id: "abef5678" });
    const relation = makeRelation({ sourceId: first.id, targetId: second.id });

    await backend.users.putUser(user);
    expect((await backend.tasks.putTask(first)).written).toBe(true);
    expect((await backend.tasks.putTask(second)).written).toBe(true);
    await backend.relations.putRelation(relation);

    expect((await backend.users.getUserByAlias(user.alias))?.id).toBe(user.id);
    expect((await backend.tasks.getTask(first.id))?.id).toBe(first.id);
    expect((await backend.tasks.findByPrefix("abc")).map((item) => item.id)).toEqual(["abcd1234"]);
    expect(await backend.relations.getRelationsForTask(first.id)).toContainEqual(relation);
  });

  it("enforces foreign keys for owner_id", async () => {
    const backend = await createBackend();

    await expect(backend.tasks.putTask(makeTask({ ownerId: "missing1" }))).rejects.toBeInstanceOf(KaryaError);
  });

  it("uses last-write-wins updates", async () => {
    const backend = await createBackend();
    const user = makeUser();
    await backend.users.putUser(user);

    const first = makeTask({ id: "zxyw9876", note: "first", openedAt: "2026-03-25T10:00:00.000Z" });
    const second = makeTask({ id: "zxyw9876", note: "second", openedAt: "2026-03-25T10:00:00.000Z" });

    expect((await backend.tasks.putTask(first)).written).toBe(true);
    expect((await backend.tasks.putTask(second)).written).toBe(true);
    expect((await backend.tasks.getTask("zxyw9876"))?.note).toBe("second");
  });

  it("rejects v0 schema databases", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-sqlite-legacy-"));
    const dbPath = join(root, "legacy.db");
    const handle = new Database(dbPath);
    handle.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        bucket TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    handle.close();

    const legacy = new SqliteBackend(dbPath);
    backends.push(legacy);

    await expect(legacy.initialize()).rejects.toThrow("Database uses v0 schema");
  });

  it("rejects schema versions not equal to 3", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-sqlite-version-"));
    const dbPath = join(root, "wrong-version.db");
    const handle = new Database(dbPath);
    handle.exec(`
      CREATE TABLE karya_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO karya_meta (key, value) VALUES ('schema_version', '2');
    `);
    handle.close();

    const legacy = new SqliteBackend(dbPath);
    backends.push(legacy);

    await expect(legacy.initialize()).rejects.toThrow("Unsupported schema version: 2. Expected 3.");
  });

  it("enforces single-parent and self-reference constraints", async () => {
    const backend = await createBackend();
    const user = makeUser();
    const parentA = makeTask({ id: "parenta1" });
    const parentB = makeTask({ id: "parentb1" });
    const child = makeTask({ id: "child001" });

    await backend.users.putUser(user);
    await backend.tasks.putTask(parentA);
    await backend.tasks.putTask(parentB);
    await backend.tasks.putTask(child);

    await backend.relations.putRelation(makeRelation({ sourceId: child.id, targetId: parentA.id, type: "parent" }));
    await expect(
      backend.relations.putRelation(makeRelation({ sourceId: child.id, targetId: parentB.id, type: "parent" })),
    ).rejects.toBeInstanceOf(KaryaError);
    await expect(
      backend.relations.putRelation(makeRelation({ sourceId: child.id, targetId: child.id, type: "blocks" })),
    ).rejects.toBeInstanceOf(KaryaError);
  });
});
