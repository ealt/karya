import type { RelationType, Task, TaskRelation, User } from "./schema.js";

export interface WriteResult {
  written: boolean;
}

export interface UserRepository {
  getUser(id: string): Promise<User | null>;
  getUserByAlias(alias: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  putUser(user: User): Promise<void>;
}

export interface TaskRepository {
  getTask(id: string): Promise<Task | null>;
  getAllTasks(): Promise<Task[]>;
  findByPrefix(prefix: string): Promise<Task[]>;
  putTask(task: Task): Promise<WriteResult>;
  deleteTask(id: string): Promise<void>;
}

export interface TaskRelationRepository {
  getRelationsForTask(taskId: string): Promise<TaskRelation[]>;
  putRelation(relation: TaskRelation): Promise<void>;
  deleteRelation(sourceId: string, targetId: string, type: RelationType): Promise<void>;
}

export interface DbBackend {
  initialize(): Promise<void>;
  close(): Promise<void>;
  users: UserRepository;
  tasks: TaskRepository;
  relations: TaskRelationRepository;
}
