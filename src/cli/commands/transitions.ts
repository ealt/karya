import { Command } from "commander";
import type { CliRuntime } from "../shared/runtime.js";

export function registerTransitionCommands(program: Command, runtime: CliRuntime): void {
  for (const [name, description] of [
    ["start", "Mark task in progress"],
    ["done", "Mark task done (archives immediately)"],
    ["cancel", "Cancel task (archives immediately)"],
  ] as const) {
    program
      .command(name)
      .description(description)
      .argument("<id>", "Task id or prefix")
      .action(async (id: string, command: Command) => {
        await runtime.runCommand(command, async (context) => {
          const operation =
            name === "start"
              ? () => context.store.startTask(id, context.config.author)
              : name === "done"
                ? () => context.store.doneTask(id, context.config.author)
                : () => context.store.cancelTask(id, context.config.author);

          const write = await runtime.runWrite(context, operation, `karya: ${name} task ${id}`);
          return {
            ok: true,
            message: `${name} ${write.result.id}`,
            data: write.result,
            warnings: write.warnings,
          };
        });
      });
  }
}
