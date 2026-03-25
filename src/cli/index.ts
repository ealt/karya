import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import { createCliRuntime } from "./shared/runtime.js";

function resolvePackageVersion(): string {
  let currentDir = dirname(fileURLToPath(import.meta.url));

  for (let index = 0; index < 5; index += 1) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const { version } = createRequire(import.meta.url)(packageJsonPath) as { version: string };
      return version;
    }

    currentDir = join(currentDir, "..");
  }

  throw new Error("Unable to locate package.json for CLI version metadata.");
}

const version = resolvePackageVersion();
const program = new Command();

program
  .name("karya")
  .description("SQL-backed task tracker for orchestrating AI agents")
  .version(version)
  .option("--db-path <path>", "Override SQLite database path")
  .option("--format <format>", "Output format: human|json")
  .option("--author <author>", "Alias used for 'me' resolution and defaults")
  .showHelpAfterError();

registerCommands(program, createCliRuntime(program));

await program.parseAsync(process.argv);
