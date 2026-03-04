import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DbBackend } from "./backend.js";
import type { BackendConfig } from "./schema.js";

export async function createBackend(config: BackendConfig): Promise<DbBackend> {
  if (config.type === "sqlite") {
    if (config.dbPath !== ":memory:" && !config.dbPath.startsWith("file:")) {
      await mkdir(dirname(config.dbPath), { recursive: true });
    }

    const { SqliteBackend } = await import("./backends/sqlite.js");
    return new SqliteBackend(config.dbPath);
  }

  const { createPool, PgBackend } = await import("./backends/pg.js");
  const pool = await createPool(config.connectionString);
  return new PgBackend(pool);
}
