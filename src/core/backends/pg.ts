import { readFile } from "node:fs/promises";
import { Pool, type PoolConfig } from "pg";
import { SCHEMA_VERSION } from "../../shared/constants.js";
import type { DbBackend, TaskRelationRepository, TaskRepository, UserRepository, WriteResult } from "../backend.js";
import { KaryaError } from "../errors.js";
import { TaskRelationSchema, TaskSchema, UserSchema, type Task, type TaskRelation, type User } from "../schema.js";

interface MetaRow {
  value: string;
}

interface UserRow {
  id: string;
  name: string;
  alias: string;
  type: string;
  created_at: string;
  deactivated_at: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  project: string;
  priority: string;
  status: string;
  note: string | null;
  owner_id: string | null;
  assignee_id: string | null;
  created_by: string;
  updated_by: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  source_id: string;
  target_id: string;
  type: string;
}

export interface PgSslOptions {
  mode: "verify-full" | "off";
  caPath?: string;
}

function parseUserRow(row: UserRow): User {
  return UserSchema.parse({
    id: row.id,
    name: row.name,
    alias: row.alias,
    type: row.type,
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at,
  });
}

function parseTaskRow(row: TaskRow): Task {
  return TaskSchema.parse({
    id: row.id,
    title: row.title,
    project: row.project,
    priority: row.priority,
    status: row.status,
    note: row.note,
    ownerId: row.owner_id,
    assigneeId: row.assignee_id,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseRelationRow(row: RelationRow): TaskRelation {
  return TaskRelationSchema.parse({
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type,
  });
}

function toValidationError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("duplicate key") ||
    message.includes("violates foreign key") ||
    message.includes("violates check constraint") ||
    message.includes("violates unique constraint")
  ) {
    throw new KaryaError(message, "VALIDATION");
  }

  throw error;
}

function redactConnectionStrings(input: string): string {
  return input
    .replace(/postgresql?:\/\/[^\s]+/gi, "postgresql://***")
    .replace(/"(host|user|username|password|database|dbname|db)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
    .replace(/\b(host|user|username|password|database|dbname|db)\s*=\s*('[^']*'|"[^"]*"|[^\s,;]+)/gi, "$1=***")
    .replace(/\b(host|user|username|password|database|dbname|db)\s*:\s*('[^']*'|"[^"]*"|[^\s,;]+)/gi, "$1:***");
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
  readonly users: UserRepository;
  readonly tasks: TaskRepository;
  readonly relations: TaskRelationRepository;

  constructor(private readonly pool: Pool) {
    this.users = {
      getUser: async (id) => {
        const result = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
        return result.rows[0] ? parseUserRow(result.rows[0]) : null;
      },
      getUserByAlias: async (alias) => {
        const result = await this.pool.query<UserRow>("SELECT * FROM users WHERE alias = $1", [alias]);
        return result.rows[0] ? parseUserRow(result.rows[0]) : null;
      },
      getAllUsers: async () => {
        const result = await this.pool.query<UserRow>("SELECT * FROM users ORDER BY alias");
        return result.rows.map(parseUserRow);
      },
      putUser: async (user) => {
        const validated = UserSchema.parse(user);
        try {
          await this.pool.query(
            `
              INSERT INTO users (id, name, alias, type, created_at, deactivated_at)
              VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                alias = excluded.alias,
                type = excluded.type,
                created_at = excluded.created_at,
                deactivated_at = excluded.deactivated_at
            `,
            [
              validated.id,
              validated.name,
              validated.alias,
              validated.type,
              validated.createdAt,
              validated.deactivatedAt,
            ],
          );
        } catch (error) {
          toValidationError(error);
        }
      },
    };

    this.tasks = {
      getTask: async (id) => {
        const result = await this.pool.query<TaskRow>("SELECT * FROM tasks WHERE id = $1", [id]);
        return result.rows[0] ? parseTaskRow(result.rows[0]) : null;
      },
      getAllTasks: async () => {
        const result = await this.pool.query<TaskRow>("SELECT * FROM tasks ORDER BY updated_at DESC");
        return result.rows.map(parseTaskRow);
      },
      findByPrefix: async (prefix) => {
        const result = await this.pool.query<TaskRow>("SELECT * FROM tasks WHERE id LIKE $1 ORDER BY id", [`${prefix}%`]);
        return result.rows.map(parseTaskRow);
      },
      putTask: async (task) => {
        const validated = TaskSchema.parse(task);
        try {
          const result = await this.pool.query(
            `
              INSERT INTO tasks (
                id, title, project, priority, status, note, owner_id, assignee_id,
                created_by, updated_by, tags, created_at, updated_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12::timestamptz, $13::timestamptz)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                project = excluded.project,
                priority = excluded.priority,
                status = excluded.status,
                note = excluded.note,
                owner_id = excluded.owner_id,
                assignee_id = excluded.assignee_id,
                created_by = excluded.created_by,
                updated_by = excluded.updated_by,
                tags = excluded.tags,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
              WHERE tasks.updated_at <= excluded.updated_at
            `,
            [
              validated.id,
              validated.title,
              validated.project,
              validated.priority,
              validated.status,
              validated.note,
              validated.ownerId,
              validated.assigneeId,
              validated.createdBy,
              validated.updatedBy,
              validated.tags,
              validated.createdAt,
              validated.updatedAt,
            ],
          );
          return { written: (result.rowCount ?? 0) > 0 } satisfies WriteResult;
        } catch (error) {
          return toValidationError(error);
        }
      },
      deleteTask: async (id) => {
        await this.pool.query("DELETE FROM tasks WHERE id = $1", [id]);
      },
    };

    this.relations = {
      getRelationsForTask: async (taskId) => {
        const result = await this.pool.query<RelationRow>(
          "SELECT * FROM task_relations WHERE source_id = $1 OR target_id = $1 ORDER BY type, source_id, target_id",
          [taskId],
        );
        return result.rows.map(parseRelationRow);
      },
      putRelation: async (relation) => {
        const validated = TaskRelationSchema.parse(relation);
        try {
          await this.pool.query(
            `
              INSERT INTO task_relations (source_id, target_id, type)
              VALUES ($1, $2, $3)
              ON CONFLICT(source_id, target_id, type) DO NOTHING
            `,
            [validated.sourceId, validated.targetId, validated.type],
          );
        } catch (error) {
          toValidationError(error);
        }
      },
      deleteRelation: async (sourceId, targetId, type) => {
        await this.pool.query("DELETE FROM task_relations WHERE source_id = $1 AND target_id = $2 AND type = $3", [
          sourceId,
          targetId,
          type,
        ]);
      },
    };
  }

  async initialize(): Promise<void> {
    const tables = await this.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = new Set(tables.rows.map((row) => row.table_name));

    if (!tableNames.has("karya_meta")) {
      if (tableNames.size === 0) {
        await this.createSchema();
        return;
      }

      if (tableNames.has("tasks")) {
        const columns = await this.pool.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks'",
        );
        if (columns.rows.some((column) => column.column_name === "bucket")) {
          throw new KaryaError("Database uses v0 schema. Please use a fresh database for v1.", "SCHEMA_MISMATCH");
        }
      }

      throw new KaryaError("Database schema is missing karya_meta. Please use a fresh database for v1.", "SCHEMA_MISMATCH");
    }

    const versionResult = await this.pool.query<MetaRow>("SELECT value FROM karya_meta WHERE key = 'schema_version'");
    const versionRow = versionResult.rows[0];
    if (!versionRow || versionRow.value !== String(SCHEMA_VERSION)) {
      throw new KaryaError(
        `Unsupported schema version: ${versionRow?.value ?? "unknown"}. Expected ${SCHEMA_VERSION}.`,
        "SCHEMA_MISMATCH",
      );
    }

    await this.createSchema();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async createSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS karya_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await this.pool.query(
      `INSERT INTO karya_meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO NOTHING`,
      [String(SCHEMA_VERSION)],
    );

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        alias TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human','agent')),
        created_at TIMESTAMPTZ NOT NULL,
        deactivated_at TIMESTAMPTZ
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT 'inbox',
        priority TEXT NOT NULL DEFAULT 'P2' CHECK(priority IN ('P0','P1','P2','P3')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','cancelled')),
        note TEXT,
        owner_id TEXT REFERENCES users(id),
        assignee_id TEXT REFERENCES users(id),
        created_by TEXT NOT NULL REFERENCES users(id),
        updated_by TEXT NOT NULL REFERENCES users(id),
        tags TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS task_relations (
        source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('parent','blocks')),
        CHECK(source_id <> target_id),
        PRIMARY KEY (source_id, target_id, type)
      )
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_id_prefix
        ON tasks (id text_pattern_ops)
    `);

    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_single_parent
        ON task_relations (source_id) WHERE type = 'parent'
    `);
  }
}
