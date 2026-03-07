import { readFile } from "node:fs/promises";
import { TaskSchema, type Task } from "../schema.js";
import type { Bucket, DbBackend, WriteResult } from "../backend.js";
import { KaryaError } from "../errors.js";
import { Pool, type PoolConfig } from "pg";

interface TaskRow {
  data: unknown;
}

export interface PgSslOptions {
  mode: "verify-full" | "off";
  caPath?: string;
}

function parseRowData(data: unknown): Task {
  if (typeof data === "string") {
    return TaskSchema.parse(JSON.parse(data));
  }

  return TaskSchema.parse(data);
}

function redactConnectionStrings(input: string): string {
  return input.replace(/postgresql?:\/\/[^\s]+/gi, "postgresql://***");
}

export async function createPool(connectionString: string, ssl?: PgSslOptions): Promise<Pool> {
  const poolSsl =
    ssl?.mode === "off"
      ? false
      : {
          rejectUnauthorized: true,
          ...(ssl?.caPath ? { ca: await readFile(ssl.caPath, "utf8") } : {}),
        };

  const config: PoolConfig = {
    connectionString,
    ssl: poolSsl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
  const pool = new Pool(config);

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new KaryaError(`Failed to connect to PostgreSQL: ${redactConnectionStrings(message)}`, "CONFIG");
  }

  return pool;
}

export class PgBackend implements DbBackend {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id         TEXT PRIMARY KEY,
        bucket     TEXT NOT NULL DEFAULT 'tasks'
                   CHECK (bucket IN ('tasks', 'archive')),
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_bucket_id
        ON tasks (bucket, id text_pattern_ops)
    `);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getTask(id: string, bucket: Bucket): Promise<Task | null> {
    const result = await this.pool.query<TaskRow>("SELECT data FROM tasks WHERE id = $1 AND bucket = $2", [id, bucket]);
    return result.rows.length > 0 ? parseRowData(result.rows[0].data) : null;
  }

  async getAllTasks(bucket: Bucket): Promise<Task[]> {
    const result = await this.pool.query<TaskRow>("SELECT data FROM tasks WHERE bucket = $1 ORDER BY updated_at DESC", [bucket]);
    return result.rows.map((row: TaskRow) => parseRowData(row.data));
  }

  async findByPrefix(prefix: string, bucket: Bucket): Promise<Task[]> {
    const result = await this.pool.query<TaskRow>(
      "SELECT data FROM tasks WHERE bucket = $1 AND id LIKE $2 ORDER BY id",
      [bucket, `${prefix}%`],
    );

    return result.rows.map((row: TaskRow) => parseRowData(row.data));
  }

  async putTask(task: Task, bucket: Bucket): Promise<WriteResult> {
    const result = await this.pool.query(
      `
        INSERT INTO tasks (id, bucket, data, updated_at, created_at)
        VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
        ON CONFLICT(id) DO UPDATE SET
          bucket = excluded.bucket,
          data = excluded.data,
          updated_at = excluded.updated_at
        WHERE tasks.updated_at <= excluded.updated_at
      `,
      [task.id, bucket, JSON.stringify(task), task.updatedAt, task.createdAt],
    );

    return { written: (result.rowCount ?? 0) > 0 };
  }

  async deleteTask(id: string, bucket: Bucket): Promise<void> {
    await this.pool.query("DELETE FROM tasks WHERE id = $1 AND bucket = $2", [id, bucket]);
  }

  async moveTask(task: Task, _from: Bucket, to: Bucket): Promise<void> {
    await this.putTask(task, to);
  }
}
