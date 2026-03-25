import { Command } from "commander";
import type { CliRuntime } from "../shared/runtime.js";

export function registerDeleteCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("delete")
    .description("Delete a task")
    .argument("<id>", "Task id or prefix")
    .action(async (id: string, _options: Record<string, boolean | undefined>, command: Command) => {
      await runtime.runCommand(
        command,
        async (context) => {
          const write = await runtime.runWrite(context, async () => context.store.deleteTask(id));

          return {
            ok: true,
            message: `Deleted ${write.result.id}`,
            data: write.result,
            warnings: write.warnings,
          };
        },
        { requireActiveUser: true },
      );
    });
}
