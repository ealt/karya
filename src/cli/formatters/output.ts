import type { OutputFormat } from "../../core/config.js";
import type { SyncWarning } from "../../core/git-sync.js";

export interface CommandOutput {
  ok: boolean;
  message?: string;
  data?: unknown;
  warnings?: SyncWarning[];
}

export function render(output: CommandOutput, format: OutputFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (output.message) {
    process.stdout.write(`${output.message}\n`);
  }

  if (output.data !== undefined) {
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
  return `${id}  ${status.padEnd(11)} ${priority}  ${project}  ${title}`;
}
