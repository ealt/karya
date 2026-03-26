import type { ListFilters, Task, User } from "./schema.js";

export type TaskListView = "open" | "closed" | "all";

export function filterTasks(
  tasks: Task[],
  filters: ListFilters,
  userLookup?: (id: string) => User | null,
  view: TaskListView = "open",
): Task[] {
  return tasks
    .filter((task) => {
      if (view === "open" && task.closedAt !== null) {
        return false;
      }
      if (view === "closed" && task.closedAt === null) {
        return false;
      }
      if (filters.project && filters.project.length > 0 && !filters.project.includes(task.project)) {
        return false;
      }
      if (filters.priority && filters.priority.length > 0 && !filters.priority.includes(task.priority)) {
        return false;
      }
      if (filters.tag && filters.tag.length > 0 && !filters.tag.every((tag) => task.tags.includes(tag))) {
        return false;
      }
      if (filters.ownerId !== undefined && task.ownerId !== filters.ownerId) {
        return false;
      }
      if (filters.assigneeId !== undefined && task.assigneeId !== filters.assigneeId) {
        return false;
      }
      if (filters.assigneeType) {
        if (!task.assigneeId || !userLookup) {
          return false;
        }

        const assignee = userLookup(task.assigneeId);
        if (!assignee || assignee.type !== filters.assigneeType) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority.localeCompare(b.priority);
      }
      const aTime = a.closedAt ?? a.openedAt;
      const bTime = b.closedAt ?? b.openedAt;
      return bTime.localeCompare(aTime);
    });
}
