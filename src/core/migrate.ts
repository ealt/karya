import { KaryaError } from "./errors.js";
import { TaskSchema, type Task } from "./schema.js";

function ensureRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new KaryaError("Invalid JSON record", "VALIDATION");
}

export function migrateTaskRecord(raw: unknown): Task {
  const record = ensureRecord(raw);
  const version = typeof record.schemaVersion === "number" ? record.schemaVersion : 0;

  if (version <= 1) {
    return TaskSchema.parse({
      ...record,
      schemaVersion: 1,
      conflicts: Array.isArray(record.conflicts) ? record.conflicts : [],
    });
  }

  throw new KaryaError(`Unsupported task schema version: ${String(record.schemaVersion)}`, "VALIDATION");
}
