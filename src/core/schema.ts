import { z } from "zod";
import {
  DEFAULT_PRIORITY,
  DEFAULT_PROJECT,
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_WEB_PORT,
} from "../shared/constants.js";

export const PrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const StatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);

export const TaskNoteSchema = z.object({
  body: z.string().min(1),
  author: z.string().min(1),
  timestamp: z.string().datetime(),
});

export const TaskConflictSchema = z.object({
  field: z.string().min(1),
  localValue: z.unknown(),
  remoteValue: z.unknown(),
  timestamp: z.string().datetime(),
});

export const TaskSchema = z.object({
  schemaVersion: z.number().int().positive().default(DEFAULT_SCHEMA_VERSION),
  id: z.string().min(8).max(8),
  title: z.string().min(1),
  description: z.string().default(""),
  project: z.string().min(1).default(DEFAULT_PROJECT),
  tags: z.array(z.string()).default([]),
  priority: PrioritySchema.default(DEFAULT_PRIORITY),
  status: StatusSchema.default("open"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  dueAt: z.string().datetime().nullable().default(null),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  parentId: z.string().nullable().default(null),
  notes: z.array(TaskNoteSchema).default([]),
  conflicts: z.array(TaskConflictSchema).optional(),
});

export const RepoConfigSchema = z.object({
  schemaVersion: z.number().int().positive().default(DEFAULT_SCHEMA_VERSION),
  defaultProject: z.string().min(1).default(DEFAULT_PROJECT),
  defaultPriority: PrioritySchema.default(DEFAULT_PRIORITY),
  autoSync: z.boolean().default(true),
  syncRetries: z.number().int().min(1).max(10).default(3),
  fetchIntervalSeconds: z.number().int().min(0).default(0),
});

export const AppConfigSchema = z.object({
  dataDir: z.string().min(1),
  defaultProject: z.string().min(1).default(DEFAULT_PROJECT),
  defaultPriority: PrioritySchema.default(DEFAULT_PRIORITY),
  autoSync: z.boolean().default(true),
  author: z.string().min(1).default("cli"),
  web: z.object({
    port: z.number().int().min(1).max(65535).default(DEFAULT_WEB_PORT),
  }),
});

export const ListFiltersSchema = z.object({
  project: z.array(z.string()).optional(),
  priority: z.array(PrioritySchema).optional(),
  status: z.array(StatusSchema).optional(),
  tag: z.array(z.string()).optional(),
  includeArchive: z.boolean().optional(),
});

export type Priority = z.infer<typeof PrioritySchema>;
export type TaskStatus = z.infer<typeof StatusSchema>;
export type TaskNote = z.infer<typeof TaskNoteSchema>;
export type TaskConflict = z.infer<typeof TaskConflictSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ListFilters = z.infer<typeof ListFiltersSchema>;
