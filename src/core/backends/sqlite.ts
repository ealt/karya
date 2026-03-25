import Database from "better-sqlite3";
import { SCHEMA_VERSION } from "../../shared/constants.js";
import type { DbBackend, TaskRelationRepository, TaskRepository, UserRepository, WriteResult } from "../backend.js";
import { KaryaError } from "../errors.js";
import { TaskRelationSchema, TaskSchema, UserSchema, type RelationType, type Task, type TaskRelation, type User } from "../schema.js";

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
  tags: string;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  source_id: string;
  target_id: string;
  type: string;
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
    tags: JSON.parse(row.tags) as string[],
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
    message.includes("UNIQUE constraint failed") ||
    message.includes("CHECK constraint failed") ||
    message.includes("FOREIGN KEY constraint failed")
  ) {
    throw new KaryaError(message, "VALIDATION");
  }

  throw error;
}

export class SqliteBackend implements DbBackend {
  private readonly db: Database.Database;

  readonly users: UserRepository;
  readonly tasks: TaskRepository;
  readonly relations: TaskRelationRepository;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.users = {
      getUser: async (id) => {
        const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
        return row ? parseUserRow(row) : null;
      },
      getUserByAlias: async (alias) => {
        const row = this.db.prepare("SELECT * FROM users WHERE alias = ?").get(alias) as UserRow | undefined;
        return row ? parseUserRow(row) : null;
      },
      getAllUsers: async () => {
        const rows = this.db.prepare("SELECT * FROM users ORDER BY alias").all() as UserRow[];
        return rows.map(parseUserRow);
      },
      putUser: async (user) => {
        const validated = UserSchema.parse(user);
        try {
          this.db
            .prepare(
              `
                INSERT INTO users (id, name, alias, type, created_at, deactivated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  alias = excluded.alias,
                  type = excluded.type,
                  created_at = excluded.created_at,
                  deactivated_at = excluded.deactivated_at
              `,
            )
            .run(
              validated.id,
              validated.name,
              validated.alias,
              validated.type,
              validated.createdAt,
              validated.deactivatedAt,
            );
        } catch (error) {
          toValidationError(error);
        }
      },
    };

    this.tasks = {
      getTask: async (id) => {
        const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
        return row ? parseTaskRow(row) : null;
      },
      getAllTasks: async () => {
        const rows = this.db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC").all() as TaskRow[];
        return rows.map(parseTaskRow);
      },
      findByPrefix: async (prefix) => {
        const rows = this.db.prepare("SELECT * FROM tasks WHERE id LIKE ? ORDER BY id").all(`${prefix}%`) as TaskRow[];
        return rows.map(parseTaskRow);
      },
      putTask: async (task) => {
        const validated = TaskSchema.parse(task);
        try {
          const result = this.db
            .prepare(
              `
                INSERT INTO tasks (
                  id, title, project, priority, status, note, owner_id, assignee_id,
                  created_by, updated_by, tags, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            )
            .run(
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
              JSON.stringify(validated.tags),
              validated.createdAt,
              validated.updatedAt,
            );
          return { written: result.changes > 0 } satisfies WriteResult;
        } catch (error) {
          return toValidationError(error);
        }
      },
      deleteTask: async (id) => {
        this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
      },
    };

    this.relations = {
      getRelationsForTask: async (taskId) => {
        const rows = this.db
          .prepare("SELECT * FROM task_relations WHERE source_id = ? OR target_id = ? ORDER BY type, source_id, target_id")
          .all(taskId, taskId) as RelationRow[];
        return rows.map(parseRelationRow);
      },
      putRelation: async (relation) => {
        const validated = TaskRelationSchema.parse(relation);
        try {
          this.db
            .prepare(
              `
                INSERT INTO task_relations (source_id, target_id, type)
                VALUES (?, ?, ?)
                ON CONFLICT(source_id, target_id, type) DO NOTHING
              `,
            )
            .run(validated.sourceId, validated.targetId, validated.type);
        } catch (error) {
          toValidationError(error);
        }
      },
      deleteRelation: async (sourceId, targetId, type) => {
        this.db.prepare("DELETE FROM task_relations WHERE source_id = ? AND target_id = ? AND type = ?").run(sourceId, targetId, type);
      },
    };
  }

  async initialize(): Promise<void> {
    const userTables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const tableNames = new Set(userTables.map((row) => row.name));

    if (!tableNames.has("karya_meta")) {
      if (tableNames.size === 0) {
        this.createSchema();
        return;
      }

      if (tableNames.has("tasks")) {
        const columns = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
        if (columns.some((column) => column.name === "bucket")) {
          throw new KaryaError("Database uses v0 schema. Please use a fresh database for v1.", "SCHEMA_MISMATCH");
        }
      }

      throw new KaryaError("Database schema is missing karya_meta. Please use a fresh database for v1.", "SCHEMA_MISMATCH");
    }

    const versionRow = this.db.prepare("SELECT value FROM karya_meta WHERE key = 'schema_version'").get() as MetaRow | undefined;
    if (!versionRow || versionRow.value !== String(SCHEMA_VERSION)) {
      throw new KaryaError(
        `Unsupported schema version: ${versionRow?.value ?? "unknown"}. Expected ${SCHEMA_VERSION}.`,
        "SCHEMA_MISMATCH",
      );
    }

    this.createSchema();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS karya_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT OR IGNORE INTO karya_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        alias TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human','agent')),
        created_at TEXT NOT NULL,
        deactivated_at TEXT
      );

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
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_relations (
        source_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('parent','blocks')),
        CHECK(source_id <> target_id),
        PRIMARY KEY (source_id, target_id, type)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_single_parent
        ON task_relations (source_id) WHERE type = 'parent';
    `);
  }
}
