import { Command } from "commander";
import type { Priority } from "../../core/schema.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerAddCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("add")
    .description("Add a new task")
    .argument("<title>", "Task title")
    .option("-d, --description <text>", "Task description")
    .option("-p, --project <project>", "Task project")
    .option("-P, --priority <priority>", "Priority P0-P3")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--due <due>", "Due date (ISO, today, tomorrow, next week)")
    .option("--parent <id>", "Parent task id")
    .option("--note <note>", "Initial note")
    .action(async (title: string, options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const write = await runtime.runWrite(context, async () =>
          context.store.addTask(
            {
              title,
              description: options.description,
              project: options.project,
              tags: runtime.parseCsv(options.tags),
              priority: options.priority as Priority | undefined,
              due: options.due,
              parentId: options.parent,
              note: options.note,
            },
            context.config.author,
            {
              project: context.config.defaultProject,
              priority: context.config.defaultPriority,
            },
          ),
        );

        return {
          ok: true,
          message: `Added ${write.result.id}`,
          data: write.result,
          warnings: write.warnings,
        };
      });
    });
}
