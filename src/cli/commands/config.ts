import { Command } from "commander";
import { saveAppConfig, setAppConfigValue } from "../../core/config.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerConfigCommand(program: Command, runtime: CliRuntime): void {
  const config = program.command("config").description("Manage configuration");

  config
    .command("init")
    .description("Initialize configured backend")
    .action(async (_: unknown, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        await context.store.ensureInitialized();
        await saveAppConfig({
          backend: context.config.backend,
          author: context.config.author,
          autoTags: context.config.autoTags,
          filterAliases: context.config.filterAliases,
        });

        return {
          ok: true,
          message:
            context.config.backend.type === "sqlite"
              ? `Initialized sqlite backend at ${context.config.backend.dbPath}`
              : "Initialized PostgreSQL backend",
          data: {
            backend: context.config.backend,
            appConfigPath: context.config.appConfigPath,
          },
        };
      });
    });

  config
    .command("set")
    .description("Set app configuration")
    .argument("<key>", "Config key")
    .argument("<value>", "Config value")
    .action(async (key: string, value: string, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        await setAppConfigValue(key, value);

        return {
          ok: true,
          message: `Updated ${key}`,
          data: {
            key,
            value,
            appConfigPath: context.config.appConfigPath,
          },
        };
      });
    });
}
