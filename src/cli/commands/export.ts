import { Command } from "commander";
import { join } from "node:path";
import { ensureDir, writeJsonAtomic } from "../../core/fs.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerExportCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("export")
    .description("Export data to JSON files")
    .option("--output <dir>", "Output directory", "./karya-export")
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const outputDir = options.output ?? "./karya-export";
        const usersDir = join(outputDir, "users");
        const tasksDir = join(outputDir, "tasks");
        const relationsDir = join(outputDir, "relations");

        await context.store.ensureInitialized();
        await Promise.all([ensureDir(usersDir), ensureDir(tasksDir), ensureDir(relationsDir)]);

        const [users, tasks, relations] = await Promise.all([
          context.backend.users.getAllUsers(),
          context.backend.tasks.getAllTasks(),
          context.backend.tasks.getAllTasks().then(async (allTasks) => {
            const seen = new Map<string, { sourceId: string; targetId: string; type: string }>();
            for (const task of allTasks) {
              const taskRelations = await context.backend.relations.getRelationsForTask(task.id);
              for (const relation of taskRelations) {
                seen.set(`${relation.sourceId}:${relation.targetId}:${relation.type}`, relation);
              }
            }
            return [...seen.values()];
          }),
        ]);

        await Promise.all([
          ...users.map((user) => writeJsonAtomic(join(usersDir, `${user.id}.json`), user)),
          ...tasks.map((task) => writeJsonAtomic(join(tasksDir, `${task.id}.json`), task)),
          ...relations.map((relation, index) => writeJsonAtomic(join(relationsDir, `${index}-${relation.type}.json`), relation)),
        ]);

        return {
          ok: true,
          message: `Exported ${users.length} user(s), ${tasks.length} task(s), and ${relations.length} relation(s) to ${outputDir}`,
          data: {
            output: outputDir,
            users: users.length,
            tasks: tasks.length,
            relations: relations.length,
          },
        };
      });
    });
}
