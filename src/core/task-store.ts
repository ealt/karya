import { MIN_ID_PREFIX } from "../shared/constants.js";
import type { Bucket, DbBackend } from "./backend.js";
import { nowIso, parseDueInput } from "./dates.js";
import { KaryaError } from "./errors.js";
import { createTaskId } from "./id.js";
import { filterTasks } from "./query.js";
import { reconcileTasks } from "./reconcile.js";
import { ListFiltersSchema, TaskSchema, type Priority, type Task, type TaskStatus } from "./schema.js";

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
  id: string;
  bucket: Bucket;
}

export interface ListTaskOptions {
  includeArchive?: boolean;
  project?: string[];
  priority?: Priority[];
  status?: TaskStatus[];
  tag?: string[];
}

export class TaskStore {
  private initializePromise: Promise<void> | null = null;

  constructor(private readonly backend: DbBackend) {}

  async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.backend.initialize();
    }

    await this.initializePromise;
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

    return this.writeTask(task, "tasks");
  }

  async listTasks(options: ListTaskOptions = {}): Promise<Task[]> {
    await this.ensureInitialized();
    const activeTasks = await this.backend.getAllTasks("tasks");
    const archiveTasks = options.includeArchive ? await this.backend.getAllTasks("archive") : [];

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

    const now = nowIso();
    const next: Task = TaskSchema.parse({
      ...ref.task,
      title: updates.title ?? ref.task.title,
      description: updates.description ?? ref.task.description,
      project: updates.project ?? ref.task.project,
      tags: updates.tags ?? ref.task.tags,
      priority: updates.priority ?? ref.task.priority,
      dueAt,
      updatedAt: now,
      updatedBy: author,
      notes: updates.note
        ? [
            ...ref.task.notes,
            {
              body: updates.note,
              author,
              timestamp: now,
            },
          ]
        : ref.task.notes,
    });

    return this.writeTask(next, "tasks");
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

  async deleteTask(idOrPrefix: string, includeArchive = true): Promise<{ id: string; bucket: Bucket }> {
    const ref = await this.resolveTaskReference(idOrPrefix, includeArchive);
    await this.backend.deleteTask(ref.id, ref.bucket);
    return { id: ref.id, bucket: ref.bucket };
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
    await this.backend.deleteTask(ref.id, "archive");
    return written;
  }

  async listProjects(): Promise<string[]> {
    await this.ensureInitialized();
    const tasks = await this.backend.getAllTasks("tasks");
    return [...new Set(tasks.map((task) => task.project))].sort();
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
      await this.backend.deleteTask(ref.id, "tasks");
      return written;
    }

    return this.writeTask(next, "tasks");
  }

  private async resolveTaskReference(idOrPrefix: string, includeArchive: boolean): Promise<TaskReference> {
    const trimmed = idOrPrefix.trim();
    if (trimmed.length < MIN_ID_PREFIX) {
      throw new KaryaError(
        `Task id prefix must be at least ${MIN_ID_PREFIX} characters. Received: ${trimmed.length}`,
        "INVALID_ID",
      );
    }

    const buckets: Bucket[] = includeArchive ? ["tasks", "archive"] : ["tasks"];
    const matches: TaskReference[] = [];

    for (const bucket of buckets) {
      const bucketMatches = await this.backend.findByPrefix(trimmed, bucket);
      for (const task of bucketMatches) {
        matches.push({ task, id: task.id, bucket });
      }
    }

    if (matches.length === 0) {
      throw new KaryaError(`Task not found: ${idOrPrefix}`, "NOT_FOUND");
    }

    if (matches.length > 1) {
      const ids = matches.map((match) => match.id).sort();
      throw new KaryaError(`Task prefix is ambiguous: ${idOrPrefix} (${ids.join(", ")})`, "AMBIGUOUS_ID");
    }

    return matches[0];
  }

  private async writeTask(task: Task, bucket: Bucket): Promise<Task> {
    await this.ensureInitialized();

    let next = task;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await this.backend.putTask(next, bucket);
      if (result.written) {
        return next;
      }

      const existing = await this.backend.getTask(next.id, bucket);
      if (!existing) {
        continue;
      }

      next = reconcileTasks(next, existing);
    }

    throw new KaryaError(`Could not write task ${task.id} due to repeated conflicts`, "WRITE_CONFLICT");
  }
}
