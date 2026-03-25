import type { Task, TaskRelation, User } from "../../src/core/schema.js";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: overrides.id ?? "user0001",
    name: overrides.name ?? "Test User",
    alias: overrides.alias ?? "tester",
    type: overrides.type ?? "human",
    createdAt: overrides.createdAt ?? "2026-03-25T00:00:00.000Z",
    deactivatedAt: overrides.deactivatedAt ?? null,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? "task0001",
    title: overrides.title ?? "Test task",
    project: overrides.project ?? "inbox",
    priority: overrides.priority ?? "P2",
    status: overrides.status ?? "open",
    note: overrides.note ?? null,
    ownerId: overrides.ownerId ?? null,
    assigneeId: overrides.assigneeId ?? null,
    createdBy: overrides.createdBy ?? "user0001",
    updatedBy: overrides.updatedBy ?? overrides.createdBy ?? "user0001",
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? "2026-03-25T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-25T00:00:00.000Z",
  };
}

export function makeRelation(overrides: Partial<TaskRelation> = {}): TaskRelation {
  return {
    sourceId: overrides.sourceId ?? "task0001",
    targetId: overrides.targetId ?? "task0002",
    type: overrides.type ?? "blocks",
  };
}
