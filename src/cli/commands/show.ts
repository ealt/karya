import { Command } from "commander";
import { formatTaskDetail } from "../formatters/output.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerShowCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("show")
    .description("Show task details")
    .argument("<id>", "Task id or prefix")
    .action(async (id: string, _options: Record<string, boolean | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const detail = await context.store.showTask(id);
        return {
          ok: true,
          data: detail,
          message: context.config.format === "human" ? formatTaskDetail(detail) : undefined,
        };
      });
    });
}
