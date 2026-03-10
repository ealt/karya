import { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerArchiveCommand } from "./archive.js";
import { registerConfigCommand } from "./config.js";
import { registerDeleteCommand } from "./delete.js";
import { registerEditCommand } from "./edit.js";
import { registerExportCommand } from "./export.js";
import { registerImportCommand } from "./import.js";
import { registerListCommand } from "./list.js";
import { registerProjectsCommand } from "./projects.js";
import { registerShowCommand } from "./show.js";
import { registerTransitionCommands } from "./transitions.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerCommands(program: Command, runtime: CliRuntime): void {
  registerAddCommand(program, runtime);
  registerListCommand(program, runtime);
  registerShowCommand(program, runtime);
  registerEditCommand(program, runtime);
  registerTransitionCommands(program, runtime);
  registerDeleteCommand(program, runtime);
  registerProjectsCommand(program, runtime);
  registerArchiveCommand(program, runtime);
  registerConfigCommand(program, runtime);
  registerExportCommand(program, runtime);
  registerImportCommand(program, runtime);
}
