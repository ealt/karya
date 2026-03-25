import { z } from "zod";
import { DEFAULT_BACKEND_TYPE, DEFAULT_PRIORITY, DEFAULT_PROJECT } from "../shared/constants.js";

export const UserTypeSchema = z.enum(["human", "agent"]);
export const PrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const RelationTypeSchema = z.enum(["parent", "blocks"]);

export const UserSchema = z.object({
  id: z.string().length(8),
  name: z.string().min(1),
  alias: z.string().min(1),
  type: UserTypeSchema.default("human"),
  createdAt: z.string().datetime(),
  deactivatedAt: z.string().datetime().nullable().default(null),
});

export const TaskSchema = z.object({
  id: z.string().length(8),
  title: z.string().min(1),
  project: z.string().min(1).default(DEFAULT_PROJECT),
  priority: PrioritySchema.default(DEFAULT_PRIORITY),
  note: z.string().nullable().default(null),
  ownerId: z.string().length(8).nullable().default(null),
  assigneeId: z.string().length(8).nullable().default(null),
  tags: z.array(z.string()).default([]),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable().default(null),
});

export const TaskRelationSchema = z.object({
  sourceId: z.string().length(8),
  targetId: z.string().length(8),
  type: RelationTypeSchema,
});

export const BackendConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sqlite").default(DEFAULT_BACKEND_TYPE),
    dbPath: z.string().min(1),
  }),
  z.object({
    type: z.literal("pg"),
    connectionString: z.string().min(1),
    ssl: z.enum(["verify-full", "off"]).default("verify-full"),
    sslCaPath: z.string().optional(),
  }),
]);

export const FilterAliasValueSchema = z.object({
  project: z.string().optional(),
  priority: PrioritySchema.optional(),
  tag: z.string().optional(),
  owner: z.string().optional(),
  assignee: z.string().optional(),
  assigneeType: UserTypeSchema.optional(),
});

export const ListFiltersSchema = z.object({
  project: z.array(z.string()).optional(),
  priority: z.array(PrioritySchema).optional(),
  tag: z.array(z.string()).optional(),
  ownerId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  assigneeType: UserTypeSchema.optional(),
});

export const AppConfigSchema = z.object({
  backend: BackendConfigSchema.optional(),
  defaultProject: z.string().min(1).default(DEFAULT_PROJECT),
  defaultPriority: PrioritySchema.default(DEFAULT_PRIORITY),
  author: z.string().min(1).default("cli"),
  autoTags: z.array(z.string()).default([]),
  filterAliases: z.record(z.string(), FilterAliasValueSchema).default({}),
});

export type UserType = z.infer<typeof UserTypeSchema>;
export type User = z.infer<typeof UserSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type RelationType = z.infer<typeof RelationTypeSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskRelation = z.infer<typeof TaskRelationSchema>;
export type BackendConfig = z.infer<typeof BackendConfigSchema>;
export type FilterAliasValue = z.infer<typeof FilterAliasValueSchema>;
export type ListFilters = z.infer<typeof ListFiltersSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
