import { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerConfigCommand } from "./config.js";
import { registerDeleteCommand } from "./delete.js";
import { registerEditCommand } from "./edit.js";
import { registerExportCommand } from "./export.js";
import { registerImportCommand } from "./import.js";
import { registerListCommand } from "./list.js";
import { registerProjectsCommand } from "./projects.js";
import { registerSetupCommand } from "./setup.js";
import { registerShowCommand } from "./show.js";
import { registerUsersCommand } from "./users.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerCommands(program: Command, runtime: CliRuntime): void {
  registerSetupCommand(program, runtime);
  registerUsersCommand(program, runtime);
  registerAddCommand(program, runtime);
  registerListCommand(program, runtime);
  registerShowCommand(program, runtime);
  registerEditCommand(program, runtime);
  registerDeleteCommand(program, runtime);
  registerProjectsCommand(program, runtime);
  registerConfigCommand(program, runtime);
  registerExportCommand(program, runtime);
  registerImportCommand(program, runtime);
}
