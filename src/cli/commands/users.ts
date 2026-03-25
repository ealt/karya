import { Command } from "commander";
import type { UserType } from "../../core/schema.js";
import type { CliRuntime } from "../shared/runtime.js";

function formatUserLine(user: { id: string; alias: string; name: string; type: string; deactivatedAt: string | null }): string {
  const state = user.deactivatedAt ? "deactivated" : "active";
  return `${user.id}  ${user.alias}  ${user.type}  ${state}  ${user.name}`;
}

export function registerUsersCommand(program: Command, runtime: CliRuntime): void {
  const users = program.command("users").description("Manage users");

  users
    .command("add")
    .description("Add a user")
    .requiredOption("--name <name>", "Display name")
    .requiredOption("--alias <alias>", "User alias")
    .option("--type <type>", "User type: human|agent")
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const user = await context.userStore.addUser({
          name: options.name as string,
          alias: options.alias as string,
          type: options.type as UserType | undefined,
        });

        return {
          ok: true,
          message: `Added user ${user.alias}`,
          data: user,
        };
      });
    });

  users
    .command("list")
    .description("List users")
    .option("--include-deactivated", "Include deactivated users")
    .action(async (options: Record<string, boolean | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const listed = await context.userStore.listUsers(options.includeDeactivated === true);
        return {
          ok: true,
          data: listed,
          message: context.config.format === "human" ? listed.map(formatUserLine).join("\n") || "No users found" : undefined,
        };
      });
    });

  users
    .command("edit")
    .description("Edit a user")
    .argument("<idOrAlias>", "User id or alias")
    .option("--name <name>", "Display name")
    .option("--alias <alias>", "Alias")
    .option("--type <type>", "Type: human|agent")
    .action(async (idOrAlias: string, options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(
        command,
        async (context) => {
          const user = await context.userStore.editUser(idOrAlias, {
            name: options.name,
            alias: options.alias,
            type: options.type as UserType | undefined,
          });

          return {
            ok: true,
            message: `Updated user ${user.alias}`,
            data: user,
          };
        }
      );
    });

  users
    .command("remove")
    .description("Deactivate a user")
    .argument("<idOrAlias>", "User id or alias")
    .action(async (idOrAlias: string, command: Command) => {
      await runtime.runCommand(
        command,
        async (context) => {
          const user = await context.userStore.deactivateUser(idOrAlias);
          return {
            ok: true,
            message: `Deactivated user ${user.alias}`,
            data: user,
          };
        }
      );
    });
}
