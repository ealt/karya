import type { Task } from "./schema.js";

export type Bucket = "tasks" | "archive";

export interface WriteResult {
  written: boolean;
}

export interface DbBackend {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getTask(id: string, bucket: Bucket): Promise<Task | null>;
  getAllTasks(bucket: Bucket): Promise<Task[]>;
  findByPrefix(prefix: string, bucket: Bucket): Promise<Task[]>;
  putTask(task: Task, bucket: Bucket): Promise<WriteResult>;
  deleteTask(id: string, bucket: Bucket): Promise<void>;
  moveTask(task: Task, from: Bucket, to: Bucket): Promise<void>;
}
