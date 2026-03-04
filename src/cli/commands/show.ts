import { Command } from "commander";
import type { CliRuntime } from "../shared/runtime.js";

export function registerShowCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("show")
    .description("Show task details")
    .argument("<id>", "Task id or prefix")
    .option("--active-only", "Only search active tasks")
    .action(async (id: string, options: Record<string, boolean | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const ref = await context.store.showTask(id, !options.activeOnly);
        return {
          ok: true,
          data: ref.task,
        };
      });
    });
}
