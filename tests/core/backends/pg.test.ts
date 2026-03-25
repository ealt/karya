import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, PgBackend } from "../../../src/core/backends/pg.js";
import { makeTask, makeUser } from "../../helpers/factories.js";

const pgUrl = process.env.KARYA_TEST_PG_URL;
const pgSslMode = process.env.KARYA_TEST_PG_SSL === "verify-full" ? "verify-full" : "off";
const pgSslCaPath = process.env.KARYA_TEST_PG_SSL_CA;

const describePg = pgUrl ? describe : describe.skip;

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
