import { Command } from "commander";
import { formatTaskLine } from "../formatters/output.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerArchiveCommand(program: Command, runtime: CliRuntime): void {
  const archive = program.command("archive").description("Archived task operations");

  archive.action(async (_: unknown, command: Command) => {
    await runtime.runCommand(command, async (context) => {
      const tasks = await context.store.listTasks({ includeArchive: true, status: ["done", "cancelled"] });
      return {
        ok: true,
        data: tasks,
        message:
          context.config.format === "human"
            ? tasks.map((task) => formatTaskLine(task)).join("\n") || "No archived tasks"
            : undefined,
      };
    });
  });

  archive
    .command("list")
    .description("List archived tasks")
    .action(async (_: unknown, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const tasks = await context.store.listTasks({ includeArchive: true, status: ["done", "cancelled"] });
        return {
          ok: true,
          data: tasks,
          message:
            context.config.format === "human"
              ? tasks.map((task) => formatTaskLine(task)).join("\n") || "No archived tasks"
              : undefined,
        };
      });
    });

  archive
    .command("restore")
    .description("Restore archived task to open")
    .argument("<id>", "Task id or prefix")
    .action(async (id: string, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const write = await runtime.runWrite(
          context,
          async () => context.store.restoreTask(id, context.config.author),
          `karya: restore task ${id}`,
        );

        return {
          ok: true,
          message: `Restored ${write.result.id}`,
          data: write.result,
          warnings: write.warnings,
        };
      });
    });
}
