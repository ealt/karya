import { Command } from "commander";
import { join } from "node:path";
import { ensureDir, writeJsonAtomic } from "../../core/fs.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerExportCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("export")
    .description("Export tasks to JSON files")
    .option("--output <dir>", "Output directory", "./karya-export")
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const outputDir = options.output ?? "./karya-export";
        const tasksDir = join(outputDir, "tasks");
        const archiveDir = join(outputDir, "archive");

        await context.store.ensureInitialized();
        await ensureDir(tasksDir);
        await ensureDir(archiveDir);

        const [tasks, archived] = await Promise.all([
          context.backend.getAllTasks("tasks"),
          context.backend.getAllTasks("archive"),
        ]);

        await Promise.all([
          ...tasks.map((task) => writeJsonAtomic(join(tasksDir, `${task.id}.json`), task)),
          ...archived.map((task) => writeJsonAtomic(join(archiveDir, `${task.id}.json`), task)),
        ]);

        return {
          ok: true,
          message: `Exported ${tasks.length + archived.length} task(s) to ${outputDir}`,
          data: {
            output: outputDir,
            tasks: tasks.length,
            archive: archived.length,
          },
        };
      });
    });
}
