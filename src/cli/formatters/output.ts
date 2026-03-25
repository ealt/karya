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

export function formatTaskLine(task: Record<string, unknown>): string {
  const id = String(task.id);
  const status = String(task.status);
  const priority = String(task.priority);
  const project = String(task.project);
  const title = String(task.title);
  const ownerId = typeof task.ownerId === "string" && task.ownerId.length > 0 ? ` owner=${task.ownerId}` : "";
  const assigneeId = typeof task.assigneeId === "string" && task.assigneeId.length > 0 ? ` assignee=${task.assigneeId}` : "";
  return `${id}  ${status.padEnd(11)} ${priority}  ${project}  ${title}${ownerId}${assigneeId}`;
}

export function formatTaskDetail(detail: {
  task: Record<string, unknown>;
  relations: Array<{ sourceId: string; targetId: string; type: string }>;
}): string {
  const lines = [
    `id: ${String(detail.task.id)}`,
    `title: ${String(detail.task.title)}`,
    `status: ${String(detail.task.status)}`,
    `priority: ${String(detail.task.priority)}`,
    `project: ${String(detail.task.project)}`,
    `createdBy: ${String(detail.task.createdBy)}`,
    `updatedBy: ${String(detail.task.updatedBy)}`,
    `createdAt: ${String(detail.task.createdAt)}`,
    `updatedAt: ${String(detail.task.updatedAt)}`,
  ];

  if (detail.task.ownerId) {
    lines.push(`ownerId: ${String(detail.task.ownerId)}`);
  }
  if (detail.task.assigneeId) {
    lines.push(`assigneeId: ${String(detail.task.assigneeId)}`);
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
