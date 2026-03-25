import type { Task } from "./schema.js";

export function reconcileTasks(local: Task, remote: Task): Task {
  const tags = Array.from(new Set([...remote.tags, ...local.tags])).sort();
  if (local.updatedAt >= remote.updatedAt) {
    return {
      ...remote,
      ...local,
      tags,
      updatedAt: local.updatedAt,
    };
  }

  return {
    ...local,
    ...remote,
    tags,
    updatedAt: remote.updatedAt,
  };
}
