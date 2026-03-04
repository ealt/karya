import { Command } from "commander";
import type { CliRuntime } from "../shared/runtime.js";

export function registerDeleteCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("delete")
    .description("Delete a task")
    .argument("<id>", "Task id or prefix")
    .option("--archive", "Allow deleting from archive")
    .action(async (id: string, options: Record<string, boolean | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const write = await runtime.runWrite(context, async () => context.store.deleteTask(id, options.archive === true));

        return {
          ok: true,
          message: `Deleted ${write.result.id} (${write.result.bucket})`,
          data: write.result,
          warnings: write.warnings,
        };
      });
    });
}
