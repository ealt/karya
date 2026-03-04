import { Command } from "commander";
import { KaryaError } from "../../core/errors.js";
import type { Priority } from "../../core/schema.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerEditCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("edit")
    .description("Edit an existing task")
    .argument("<id>", "Task id or prefix")
    .option("--title <title>", "New title")
    .option("--description <description>", "New description")
    .option("-p, --project <project>", "Project")
    .option("-P, --priority <priority>", "Priority")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--due <due>", "Due date")
    .option("--clear-due", "Clear due date")
    .option("--note <note>", "Append note")
    .action(async (id: string, options: Record<string, string | boolean | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const patch = {
          title: options.title as string | undefined,
          description: options.description as string | undefined,
          project: options.project as string | undefined,
          tags: runtime.parseCsv(options.tags as string | undefined),
          priority: options.priority as Priority | undefined,
          due: options.clearDue ? null : (options.due as string | undefined),
          note: options.note as string | undefined,
        };

        const hasChanges = Object.values(patch).some((value) => value !== undefined);
        if (!hasChanges) {
          throw new KaryaError("No edits provided.", "USAGE");
        }

        const write = await runtime.runWrite(context, async () => context.store.editTask(id, patch, context.config.author));

        return {
          ok: true,
          message: `Updated ${write.result.id}`,
          data: write.result,
          warnings: write.warnings,
        };
      });
    });
}
