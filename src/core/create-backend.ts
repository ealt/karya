import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DbBackend } from "./backend.js";
import { KaryaError } from "./errors.js";
import type { BackendConfig } from "./schema.js";

export async function createBackend(config: BackendConfig): Promise<DbBackend> {
  if (config.type === "sqlite") {
    if (config.dbPath !== ":memory:" && !config.dbPath.startsWith("file:")) {
      await mkdir(dirname(config.dbPath), { recursive: true });
    }

    const { SqliteBackend } = await import("./backends/sqlite.js");
    return new SqliteBackend(config.dbPath);
  }

  let pgModule: typeof import("./backends/pg.js");
  try {
    pgModule = await import("./backends/pg.js");
  } catch {
    throw new KaryaError(
      "PostgreSQL backend requires the 'pg' package. Install it with: npm install -g pg",
      "CONFIG",
    );
  }

  const pool = await pgModule.createPool(config.connectionString, {
    mode: config.ssl,
    caPath: config.sslCaPath,
  });
  return new pgModule.PgBackend(pool);
}
