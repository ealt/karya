import type { Task, TaskConflict } from "./schema.js";
import { nowIso } from "./dates.js";

function mergeNotes(local: Task["notes"], remote: Task["notes"]): Task["notes"] {
  const seen = new Set<string>();
  const merged = [...local, ...remote].filter((note) => {
    const key = `${note.timestamp}|${note.author}|${note.body}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return merged;
}

export function reconcileTasks(local: Task, remote: Task): Task {
  const merged: Task = { ...remote };
  const conflicts: TaskConflict[] = [];

  for (const key of Object.keys(local) as (keyof Task)[]) {
    if (key === "notes") {
      merged.notes = mergeNotes(local.notes, remote.notes);
      continue;
    }
    if (key === "conflicts") {
      continue;
    }
    if (key === "id") {
      merged.id = local.id;
      continue;
    }

    const localValue = local[key];
    const remoteValue = remote[key];

    if (JSON.stringify(localValue) === JSON.stringify(remoteValue)) {
      (merged as Record<string, unknown>)[key] = localValue;
      continue;
    }

    if (local.updatedAt >= remote.updatedAt) {
      (merged as Record<string, unknown>)[key] = localValue;
      if (key !== "updatedAt") {
        conflicts.push({
          field: String(key),
          localValue,
          remoteValue,
          timestamp: nowIso(),
        });
      }
    } else {
      (merged as Record<string, unknown>)[key] = remoteValue;
    }
  }

  if (conflicts.length > 0) {
    merged.conflicts = [...(remote.conflicts ?? []), ...conflicts];
  }

  merged.updatedAt = local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt;

  return merged;
}
