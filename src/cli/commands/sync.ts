import { Command } from "commander";
import type { CliRuntime } from "../shared/runtime.js";

export function registerSyncCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("sync")
    .description("Run explicit git sync")
    .action(async (_: unknown, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        await context.sync.initRepo();
        const sync = await context.sync.syncWithRetries(context.config.syncRetries);
        return {
          ok: true,
          message: sync.pushed ? "Sync complete" : "Sync completed with local-only state",
          data: sync,
          warnings: sync.warnings,
        };
      });
    });
}
