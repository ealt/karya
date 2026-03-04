import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import { createCliRuntime } from "./shared/runtime.js";

const program = new Command();

program
  .name("karya")
  .description("Git-backed task tracker for AI agent workflows")
  .option("--data-dir <path>", "Override data directory")
  .option("--format <format>", "Output format: human|json")
  .option("--no-sync", "Disable automatic sync")
  .option("--author <author>", "Author metadata for updates")
  .showHelpAfterError();

registerCommands(program, createCliRuntime(program));

await program.parseAsync(process.argv);
