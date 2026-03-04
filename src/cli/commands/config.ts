import { Command } from "commander";
import { initDataRepo, setAppConfigValue } from "../../core/config.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerConfigCommand(program: Command, runtime: CliRuntime): void {
  const config = program.command("config").description("Manage configuration");

  config
    .command("init")
    .description("Initialize data directory and repo config")
    .action(async (_: unknown, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        await initDataRepo(context.config.dataDir, context.config.author);
        await context.sync.initRepo();

        return {
          ok: true,
          message: `Initialized data repo at ${context.config.dataDir}`,
          data: {
            dataDir: context.config.dataDir,
            appConfigPath: context.config.appConfigPath,
            repoConfigPath: context.config.repoConfigPath,
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
