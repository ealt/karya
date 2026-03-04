import { Command } from "commander";
import type { Priority, TaskStatus } from "../../core/schema.js";
import { formatTaskLine } from "../formatters/output.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerListCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("list")
    .description("List tasks")
    .option("-p, --project <projects>", "Comma-separated projects")
    .option("-P, --priority <priorities>", "Comma-separated priorities")
    .option("-s, --status <statuses>", "Comma-separated statuses")
    .option("-t, --tag <tags>", "Comma-separated tags")
    .option("--archive", "Include archive tasks")
    .action(async (options: Record<string, string | boolean | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const tasks = await context.store.listTasks({
          includeArchive: options.archive === true,
          project: runtime.parseCsv(options.project as string | undefined),
          priority: runtime.parseCsv(options.priority as string | undefined) as Priority[] | undefined,
          status: runtime.parseCsv(options.status as string | undefined) as TaskStatus[] | undefined,
          tag: runtime.parseCsv(options.tag as string | undefined),
        });

        if (context.config.format === "json") {
          return {
            ok: true,
            data: tasks,
          };
        }

        const lines = tasks.map((task) => formatTaskLine(task));
        return {
          ok: true,
          message: lines.length > 0 ? lines.join("\n") : "No tasks found",
        };
      });
    });
}
