import { Command } from "commander";
import type { CliRuntime } from "../shared/runtime.js";

export function registerProjectsCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("projects")
    .description("List projects")
    .action(async (_: unknown, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const projects = await context.store.listProjects();
        return {
          ok: true,
          data: projects,
          message: context.config.format === "human" ? projects.join("\n") || "No projects" : undefined,
        };
      });
    });
}
