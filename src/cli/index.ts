import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import { createCliRuntime } from "./shared/runtime.js";

const program = new Command();

program
  .name("karya")
  .description("SQL-backed task tracker for orchestrating AI agents")
  .option("--db-path <path>", "Override SQLite database path")
  .option("--data-dir <path>", "Legacy alias; interpreted as <path>/karya.db")
  .option("--format <format>", "Output format: human|json")
  .option("--author <author>", "Author metadata for updates")
  .option("--skip-legacy-check", "Skip legacy JSON task directory detection")
  .showHelpAfterError();

registerCommands(program, createCliRuntime(program));

await program.parseAsync(process.argv);
