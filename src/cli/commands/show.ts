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
        let message: string | undefined;
        if (context.config.format === "human") {
          const users = await context.userStore.listUsers(true);
          const aliasMap = new Map(users.map((u) => [u.id, u.alias]));
          message = formatTaskDetail(detail, (uid) => aliasMap.get(uid) ?? uid);
        }
        return {
          ok: true,
          data: detail,
          message,
        };
      });
    });
}
