import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MIN_ID_PREFIX } from "../shared/constants.js";
import { KaryaError } from "./errors.js";
import { ensureDir, writeJsonAtomic } from "./fs.js";
import { migrateTaskRecord } from "./migrate.js";
import { filterTasks } from "./query.js";
import { reconcileTasks } from "./reconcile.js";
import {
  ListFiltersSchema,
  type Priority,
  type Task,
  type TaskStatus,
} from "./schema.js";
import { nowIso, parseDueInput } from "./dates.js";
import { createTaskId } from "./id.js";
import { TaskSchema } from "./schema.js";

export interface AddTaskInput {
  title: string;
  description?: string;
  project?: string;
  tags?: string[];
  priority?: Priority;
  due?: string;
  parentId?: string | null;
  note?: string;
}

export interface EditTaskInput {
  title?: string;
  description?: string;
  project?: string;
  tags?: string[];
  priority?: Priority;
  due?: string | null;
  note?: string;
}

export interface TaskReference {
  task: Task;
  path: string;
  bucket: "tasks" | "archive";
}

export interface ListTaskOptions {
  includeArchive?: boolean;
  project?: string[];
  priority?: Priority[];
  status?: TaskStatus[];
  tag?: string[];
}

export class TaskStore {
  readonly tasksDir: string;
  readonly archiveDir: string;
  readonly projectsDir: string;

  constructor(readonly dataDir: string) {
    this.tasksDir = join(dataDir, "tasks");
    this.archiveDir = join(dataDir, "archive");
    this.projectsDir = join(dataDir, "projects");
  }

  async ensureInitialized(): Promise<void> {
    await ensureDir(this.dataDir);
    await ensureDir(this.tasksDir);
    await ensureDir(this.archiveDir);
    await ensureDir(this.projectsDir);
  }

  async addTask(input: AddTaskInput, author: string, defaults: { project: string; priority: Priority }): Promise<Task> {
    await this.ensureInitialized();

    const dueAt = parseDueInput(input.due);
    if (input.due && dueAt === null) {
      throw new KaryaError(`Invalid due date: ${input.due}`, "VALIDATION");
    }

    const now = nowIso();
    const task = TaskSchema.parse({
      schemaVersion: 1,
      id: createTaskId(),
      title: input.title,
      description: input.description ?? "",
      project: input.project ?? defaults.project,
      tags: input.tags ?? [],
      priority: input.priority ?? defaults.priority,
      status: "open",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      dueAt,
      createdBy: author,
      updatedBy: author,
      parentId: input.parentId ?? null,
      notes: input.note
        ? [
            {
              body: input.note,
              author,
              timestamp: now,
            },
          ]
        : [],
    });

    const written = await this.writeTask(task, "tasks");
    return written;
  }

  async listTasks(options: ListTaskOptions = {}): Promise<Task[]> {
    await this.ensureInitialized();
    const activeTasks = await this.readAllTasks(this.tasksDir);
    const archiveTasks = options.includeArchive ? await this.readAllTasks(this.archiveDir) : [];
    const filters = ListFiltersSchema.parse({
      project: options.project,
      priority: options.priority,
      status: options.status,
      tag: options.tag,
    });
    return filterTasks([...activeTasks, ...archiveTasks], filters);
  }

  async showTask(idOrPrefix: string, includeArchive = true): Promise<TaskReference> {
    await this.ensureInitialized();
    return this.resolveTaskReference(idOrPrefix, includeArchive);
  }

  async editTask(idOrPrefix: string, updates: EditTaskInput, author: string): Promise<Task> {
    const ref = await this.resolveTaskReference(idOrPrefix, true);
    if (ref.bucket === "archive") {
      throw new KaryaError("Cannot edit archived task. Restore it first.", "INVALID_STATE");
    }

    const dueAt = updates.due === undefined ? ref.task.dueAt : updates.due === null ? null : parseDueInput(updates.due);
    if (updates.due !== undefined && updates.due !== null && dueAt === null) {
      throw new KaryaError(`Invalid due date: ${updates.due}`, "VALIDATION");
    }

    const next: Task = TaskSchema.parse({
      ...ref.task,
      title: updates.title ?? ref.task.title,
      description: updates.description ?? ref.task.description,
      project: updates.project ?? ref.task.project,
      tags: updates.tags ?? ref.task.tags,
      priority: updates.priority ?? ref.task.priority,
      dueAt,
      updatedAt: nowIso(),
      updatedBy: author,
      notes: updates.note
        ? [
            ...ref.task.notes,
            {
              body: updates.note,
              author,
              timestamp: nowIso(),
            },
          ]
        : ref.task.notes,
    });

    const written = await this.writeTask(next, "tasks");
    return written;
  }

  async startTask(idOrPrefix: string, author: string): Promise<Task> {
    return this.transitionTask(idOrPrefix, "in_progress", author);
  }

  async doneTask(idOrPrefix: string, author: string): Promise<Task> {
    return this.transitionTask(idOrPrefix, "done", author);
  }

  async cancelTask(idOrPrefix: string, author: string): Promise<Task> {
    return this.transitionTask(idOrPrefix, "cancelled", author);
  }

  async deleteTask(idOrPrefix: string, includeArchive = true): Promise<{ id: string; bucket: "tasks" | "archive" }> {
    const ref = await this.resolveTaskReference(idOrPrefix, includeArchive);
    await rm(ref.path, { force: true });
    return { id: ref.task.id, bucket: ref.bucket };
  }

  async restoreTask(idOrPrefix: string, author: string): Promise<Task> {
    const ref = await this.resolveTaskReference(idOrPrefix, true);
    if (ref.bucket !== "archive") {
      throw new KaryaError("Task is not archived.", "INVALID_STATE");
    }

    const restored = TaskSchema.parse({
      ...ref.task,
      status: "open",
      completedAt: null,
      updatedAt: nowIso(),
      updatedBy: author,
    });

    const written = await this.writeTask(restored, "tasks");
    await rm(ref.path, { force: true });
    return written;
  }

  async listProjects(): Promise<string[]> {
    await this.ensureInitialized();
    const tasks = await this.readAllTasks(this.tasksDir);
    const fromTasks = new Set(tasks.map((task) => task.project));

    const files = await readdir(this.projectsDir, { withFileTypes: true });
    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      fromTasks.add(entry.name.replace(/\.json$/, ""));
    }

    return [...fromTasks].sort();
  }

  private async transitionTask(idOrPrefix: string, status: TaskStatus, author: string): Promise<Task> {
    const ref = await this.resolveTaskReference(idOrPrefix, true);

    if (ref.bucket === "archive") {
      if (ref.task.status === status) {
        return ref.task;
      }
      throw new KaryaError("Task is archived and cannot transition without restore.", "INVALID_STATE");
    }

    if (ref.task.status === status) {
      return ref.task;
    }

    const now = nowIso();
    const next: Task = TaskSchema.parse({
      ...ref.task,
      status,
      startedAt: status === "in_progress" ? (ref.task.startedAt ?? now) : ref.task.startedAt,
      completedAt: status === "done" || status === "cancelled" ? now : ref.task.completedAt,
      updatedAt: now,
      updatedBy: author,
    });

    const isTerminal = status === "done" || status === "cancelled";

    if (isTerminal) {
      const written = await this.writeTask(next, "archive");
      await rm(ref.path, { force: true });
      return written;
    }

    const written = await this.writeTask(next, "tasks");
    return written;
  }

  private async resolveTaskReference(idOrPrefix: string, includeArchive: boolean): Promise<TaskReference> {
    const trimmed = idOrPrefix.trim();
    if (trimmed.length < MIN_ID_PREFIX) {
      throw new KaryaError(
        `Task id prefix must be at least ${MIN_ID_PREFIX} characters. Received: ${trimmed.length}`,
        "INVALID_ID",
      );
    }

    const buckets: Array<"tasks" | "archive"> = includeArchive ? ["tasks", "archive"] : ["tasks"];
    const matches: TaskReference[] = [];

    for (const bucket of buckets) {
      const dir = bucket === "tasks" ? this.tasksDir : this.archiveDir;
      const files = await readdir(dir, { withFileTypes: true });
      for (const entry of files) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }
        const id = entry.name.replace(/\.json$/, "");
        if (!id.startsWith(trimmed)) {
          continue;
        }
        const path = join(dir, entry.name);
        const task = migrateTaskRecord(JSON.parse(await readFile(path, "utf8")));
        matches.push({ task, path, bucket });
      }
    }

    if (matches.length === 0) {
      throw new KaryaError(`Task not found: ${idOrPrefix}`, "NOT_FOUND");
    }

    if (matches.length > 1) {
      const ids = matches.map((match) => match.task.id).sort();
      throw new KaryaError(`Task prefix is ambiguous: ${idOrPrefix} (${ids.join(", ")})`, "AMBIGUOUS_ID");
    }

    return matches[0];
  }

  private async readAllTasks(dir: string): Promise<Task[]> {
    const files = await readdir(dir, { withFileTypes: true });
    const tasks: Task[] = [];
    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const raw = await readFile(join(dir, entry.name), "utf8");
      tasks.push(migrateTaskRecord(JSON.parse(raw)));
    }
    return tasks;
  }

  private async writeTask(task: Task, bucket: "tasks" | "archive"): Promise<Task> {
    const dir = bucket === "tasks" ? this.tasksDir : this.archiveDir;
    await ensureDir(dir);
    const path = join(dir, `${task.id}.json`);
    const merged = await this.reconcileWithExisting(path, task);
    await writeJsonAtomic(path, merged);
    return merged;
  }

  private async reconcileWithExisting(path: string, incoming: Task): Promise<Task> {
    try {
      const existing = migrateTaskRecord(JSON.parse(await readFile(path, "utf8")));
      if (existing.updatedAt < incoming.updatedAt) {
        return incoming;
      }
      return reconcileTasks(incoming, existing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return incoming;
      }
      throw error;
    }
  }
}
