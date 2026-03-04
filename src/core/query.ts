import type { ListFilters, Task } from "./schema.js";

export function filterTasks(tasks: Task[], filters: ListFilters): Task[] {
  return tasks
    .filter((task) => {
      if (filters.project && filters.project.length > 0 && !filters.project.includes(task.project)) {
        return false;
      }
      if (filters.priority && filters.priority.length > 0 && !filters.priority.includes(task.priority)) {
        return false;
      }
      if (filters.status && filters.status.length > 0 && !filters.status.includes(task.status)) {
        return false;
      }
      if (filters.tag && filters.tag.length > 0 && !filters.tag.every((tag) => task.tags.includes(tag))) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority.localeCompare(b.priority);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}
