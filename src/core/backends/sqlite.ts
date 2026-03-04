import Database from "better-sqlite3";
import type { Bucket, DbBackend, WriteResult } from "../backend.js";
import { TaskSchema, type Task } from "../schema.js";

function parseRowData(data: string): Task {
  return TaskSchema.parse(JSON.parse(data));
}

export class SqliteBackend implements DbBackend {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id         TEXT PRIMARY KEY,
        bucket     TEXT NOT NULL DEFAULT 'tasks'
                   CHECK (bucket IN ('tasks', 'archive')),
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_bucket_id ON tasks (bucket, id);
    `);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async getTask(id: string, bucket: Bucket): Promise<Task | null> {
    const row = this.db.prepare("SELECT data FROM tasks WHERE id = ? AND bucket = ?").get(id, bucket) as
      | { data: string }
      | undefined;
    return row ? parseRowData(row.data) : null;
  }

  async getAllTasks(bucket: Bucket): Promise<Task[]> {
    const rows = this.db.prepare("SELECT data FROM tasks WHERE bucket = ? ORDER BY updated_at DESC").all(bucket) as Array<{
      data: string;
    }>;
    return rows.map((row) => parseRowData(row.data));
  }

  async findByPrefix(prefix: string, bucket: Bucket): Promise<Task[]> {
    const rows = this.db
      .prepare("SELECT data FROM tasks WHERE bucket = ? AND id LIKE ? ORDER BY id")
      .all(bucket, `${prefix}%`) as Array<{ data: string }>;

    return rows.map((row) => parseRowData(row.data));
  }

  async putTask(task: Task, bucket: Bucket): Promise<WriteResult> {
    const result = this.db
      .prepare(
        `
        INSERT INTO tasks (id, bucket, data, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          bucket = excluded.bucket,
          data = excluded.data,
          updated_at = excluded.updated_at
        WHERE tasks.updated_at <= excluded.updated_at
      `,
      )
      .run(task.id, bucket, JSON.stringify(task), task.updatedAt, task.createdAt);

    return { written: result.changes > 0 };
  }

  async deleteTask(id: string, bucket: Bucket): Promise<void> {
    this.db.prepare("DELETE FROM tasks WHERE id = ? AND bucket = ?").run(id, bucket);
  }

  async moveTask(task: Task, _from: Bucket, to: Bucket): Promise<void> {
    await this.putTask(task, to);
  }
}
