import { MIN_ID_PREFIX } from "../shared/constants.js";
import type { DbBackend } from "./backend.js";
import { nowIso } from "./dates.js";
import { KaryaError } from "./errors.js";
import { createId } from "./id.js";
import { filterTasks, type TaskListView } from "./query.js";
import {
  ListFiltersSchema,
  TaskRelationSchema,
  TaskSchema,
  type Priority,
  type RelationType,
  type Task,
  type TaskRelation,
} from "./schema.js";

export interface AddTaskInput {
  title: string;
  project?: string;
  tags?: string[];
  priority?: Priority;
  note?: string | null;
  ownerId?: string;
  assigneeId?: string;
  parentId?: string;
}

export interface EditTaskInput {
  title?: string;
  project?: string;
  priority?: Priority;
  note?: string | null;
  ownerId?: string | null;
  assigneeId?: string | null;
  close?: boolean;
  reopen?: boolean;
  tags?: string[];
  addTags?: string[];
  rmTags?: string[];
  editTags?: string[];
}

export interface TaskReference {
  task: Task;
  id: string;
}

export interface TaskDetail {
  task: Task;
  relations: TaskRelation[];
}

export interface ListTaskOptions {
  project?: string[];
  priority?: Priority[];
  tag?: string[];
  ownerId?: string | null;
  assigneeId?: string | null;
  assigneeType?: "human" | "agent";
  view?: TaskListView;
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

  async addTask(input: AddTaskInput, defaults: { project: string; priority: Priority }): Promise<Task> {
    await this.ensureInitialized();
    await this.requireAssignableUserId(input.ownerId);
    await this.requireAssignableUserId(input.assigneeId);

    const now = nowIso();
    const task = TaskSchema.parse({
      id: createId(),
      title: input.title,
      project: input.project ?? defaults.project,
      priority: input.priority ?? defaults.priority,
      note: input.note ?? null,
      ownerId: input.ownerId ?? null,
      assigneeId: input.assigneeId ?? null,
      tags: input.tags ?? [],
      openedAt: now,
      closedAt: null,
    });

    const written = await this.writeTask(task);
    if (input.parentId) {
      await this.addRelation(written.id, input.parentId, "parent");
    }
    return written;
  }

  async listTasks(options: ListTaskOptions = {}): Promise<Task[]> {
    await this.ensureInitialized();
    const [tasks, users] = await Promise.all([this.backend.tasks.getAllTasks(), this.backend.users.getAllUsers()]);
    const { view = "open", ...rawFilters } = options;
    const filters = ListFiltersSchema.parse(rawFilters);
    const userMap = new Map(users.map((user) => [user.id, user]));
    return filterTasks(tasks, filters, (id) => userMap.get(id) ?? null, view);
  }

  async showTask(idOrPrefix: string): Promise<TaskDetail> {
    await this.ensureInitialized();
    const ref = await this.resolveTaskReference(idOrPrefix);
    const relations = await this.backend.relations.getRelationsForTask(ref.id);
    return {
      task: ref.task,
      relations,
    };
  }

  async editTask(idOrPrefix: string, updates: EditTaskInput): Promise<Task> {
    await this.ensureInitialized();

    const ref = await this.resolveTaskReference(idOrPrefix);
    const nextOwnerId = updates.ownerId === undefined ? ref.task.ownerId : updates.ownerId;
    const nextAssigneeId = updates.assigneeId === undefined ? ref.task.assigneeId : updates.assigneeId;

    await this.requireAssignableUserId(nextOwnerId ?? undefined);
    await this.requireAssignableUserId(nextAssigneeId ?? undefined);

    let tags = updates.tags ? [...updates.tags] : [...ref.task.tags];
    if (updates.addTags) {
      for (const tag of updates.addTags) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
    if (updates.rmTags) {
      tags = tags.filter((tag) => !updates.rmTags?.includes(tag));
    }
    if (updates.editTags) {
      for (const spec of updates.editTags) {
        const key = spec.includes(":") ? `${spec.split(":", 1)[0]}:` : spec;
        tags = tags.filter((tag) => (key.endsWith(":") ? !tag.startsWith(key) : tag !== key));
        tags.push(spec);
      }
    }

    let closedAt = ref.task.closedAt;
    if (updates.reopen) {
      closedAt = null;
    } else if (updates.close && closedAt === null) {
      closedAt = nowIso();
    }

    const next = TaskSchema.parse({
      ...ref.task,
      title: updates.title ?? ref.task.title,
      project: updates.project ?? ref.task.project,
      priority: updates.priority ?? ref.task.priority,
      note: updates.note === undefined ? ref.task.note : updates.note,
      ownerId: nextOwnerId ?? null,
      assigneeId: nextAssigneeId ?? null,
      tags,
      closedAt,
    });

    return this.writeTask(next);
  }

  async deleteTask(idOrPrefix: string): Promise<{ id: string }> {
    await this.ensureInitialized();
    const ref = await this.resolveTaskReference(idOrPrefix);
    await this.backend.tasks.deleteTask(ref.id);
    return { id: ref.id };
  }

  async listProjects(): Promise<string[]> {
    await this.ensureInitialized();
    const tasks = await this.backend.tasks.getAllTasks();
    return [...new Set(tasks.map((task) => task.project))].sort();
  }

  async addRelation(sourceIdOrPrefix: string, targetIdOrPrefix: string, type: RelationType): Promise<TaskRelation> {
    await this.ensureInitialized();
    const source = await this.resolveTaskReference(sourceIdOrPrefix);
    const target = await this.resolveTaskReference(targetIdOrPrefix);

    if (type === "parent") {
      await this.assertNoParentCycle(source.id, target.id);
      const existing = await this.backend.relations.getRelationsForTask(source.id);
      if (existing.some((relation) => relation.type === "parent" && relation.targetId !== target.id)) {
        throw new KaryaError(`Task ${source.id} already has a parent`, "VALIDATION");
      }
    }

    const relation = TaskRelationSchema.parse({
      sourceId: source.id,
      targetId: target.id,
      type,
    });
    await this.backend.relations.putRelation(relation);
    return relation;
  }

  async removeRelation(sourceIdOrPrefix: string, targetIdOrPrefix: string, type: RelationType): Promise<void> {
    await this.ensureInitialized();
    const source = await this.resolveTaskReference(sourceIdOrPrefix);
    const target = await this.resolveTaskReference(targetIdOrPrefix);
    await this.backend.relations.deleteRelation(source.id, target.id, type);
  }

  async resolveTaskReference(idOrPrefix: string): Promise<TaskReference> {
    const trimmed = idOrPrefix.trim();
    if (trimmed.length < MIN_ID_PREFIX) {
      throw new KaryaError(
        `Task id prefix must be at least ${MIN_ID_PREFIX} characters. Received: ${trimmed.length}`,
        "INVALID_ID",
      );
    }

    const matches = await this.backend.tasks.findByPrefix(trimmed);
    if (matches.length === 0) {
      throw new KaryaError(`Task not found: ${idOrPrefix}`, "NOT_FOUND");
    }
    if (matches.length > 1) {
      const ids = matches.map((task) => task.id).sort();
      throw new KaryaError(`Task prefix is ambiguous: ${idOrPrefix} (${ids.join(", ")})`, "AMBIGUOUS_ID");
    }

    return {
      task: matches[0],
      id: matches[0].id,
    };
  }

  private async requireAssignableUserId(id: string | undefined): Promise<void> {
    if (!id) {
      return;
    }

    const user = await this.backend.users.getUser(id);
    if (!user || user.deactivatedAt) {
      throw new KaryaError(`User not found or inactive: ${id}`, "INVALID_STATE");
    }
  }

  private async assertNoParentCycle(sourceId: string, targetId: string): Promise<void> {
    if (sourceId === targetId) {
      throw new KaryaError("Parent relation cannot reference the same task", "VALIDATION");
    }

    const seen = new Set<string>([targetId]);
    let current = targetId;

    while (true) {
      const relations = await this.backend.relations.getRelationsForTask(current);
      const parent = relations.find((relation) => relation.type === "parent" && relation.sourceId === current);
      if (!parent) {
        return;
      }
      if (parent.targetId === sourceId) {
        throw new KaryaError("Parent relation would create a cycle", "VALIDATION");
      }
      if (seen.has(parent.targetId)) {
        throw new KaryaError("Parent relation cycle detected", "VALIDATION");
      }

      seen.add(parent.targetId);
      current = parent.targetId;
    }
  }

  private async writeTask(task: Task): Promise<Task> {
    await this.backend.tasks.putTask(task);
    return task;
  }
}
