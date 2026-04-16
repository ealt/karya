import type { OutputFormat } from "../../core/config.js";
import type { Warning } from "../../shared/types.js";

export interface CommandOutput {
  ok: boolean;
  message?: string;
  data?: unknown;
  warnings?: Warning[];
}

export function render(output: CommandOutput, format: OutputFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (output.message) {
    process.stdout.write(`${output.message}\n`);
  }

  if (output.data !== undefined && !output.message) {
    if (typeof output.data === "string") {
      process.stdout.write(`${output.data}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(output.data, null, 2)}\n`);
    }
  }

  if (output.warnings && output.warnings.length > 0) {
    for (const warning of output.warnings) {
      process.stderr.write(`warning [${warning.code}]: ${warning.message}\n`);
    }
  }
}

export type AliasResolver = (id: string) => string;

export function formatTaskLine(task: Record<string, unknown>, resolveAlias?: AliasResolver): string {
  const id = String(task.id);
  const priority = String(task.priority);
  const project = String(task.project);
  const title = String(task.title);
  const resolve = resolveAlias ?? String;
  const ownerId = typeof task.ownerId === "string" && task.ownerId.length > 0 ? ` owner=${resolve(task.ownerId)}` : "";
  const assigneeId = typeof task.assigneeId === "string" && task.assigneeId.length > 0 ? ` assignee=${resolve(task.assigneeId)}` : "";
  const closedAt = typeof task.closedAt === "string" && task.closedAt.length > 0 ? ` closedAt=${task.closedAt}` : "";
  return `${id}  ${priority}  ${project}  ${title}${ownerId}${assigneeId}${closedAt}`;
}

export function formatTaskDetail(
  detail: {
    task: Record<string, unknown>;
    relations: Array<{ sourceId: string; targetId: string; type: string }>;
  },
  resolveAlias?: AliasResolver,
): string {
  const resolve = resolveAlias ?? String;
  const lines = [
    `id: ${String(detail.task.id)}`,
    `title: ${String(detail.task.title)}`,
    `priority: ${String(detail.task.priority)}`,
    `project: ${String(detail.task.project)}`,
    `openedAt: ${String(detail.task.openedAt)}`,
  ];
  if (detail.task.closedAt) {
    lines.push(`closedAt: ${String(detail.task.closedAt)}`);
  }

  if (detail.task.ownerId) {
    lines.push(`owner: ${resolve(String(detail.task.ownerId))}`);
  }
  if (detail.task.assigneeId) {
    lines.push(`assignee: ${resolve(String(detail.task.assigneeId))}`);
  }
  if (Array.isArray(detail.task.tags)) {
    lines.push(`tags: ${(detail.task.tags as string[]).join(", ") || "(none)"}`);
  }
  if (detail.task.note !== null && detail.task.note !== undefined) {
    lines.push(`note: ${String(detail.task.note)}`);
  }
  if (detail.relations.length > 0) {
    for (const relation of detail.relations) {
      lines.push(`relation: ${relation.sourceId} ${relation.type} ${relation.targetId}`);
    }
  }

  return lines.join("\n");
}
