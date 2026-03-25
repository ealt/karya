import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Task, TaskRelation, User } from "../../core/schema.js";
import type { Warning } from "../../shared/types.js";
import type { CliRuntime } from "../shared/runtime.js";
import { Command } from "commander";

async function readJsonItems<T>(inputDir: string, kind: string): Promise<Array<{ value: T; file: string }>> {
  const dir = join(inputDir, kind);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: Array<{ value: T; file: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const path = join(dir, entry.name);
    const raw = await readFile(path, "utf8");
    items.push({ value: JSON.parse(raw) as T, file: path });
  }

  return items;
}

export function registerImportCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("import")
    .description("Import data from JSON files")
    .option("--input <dir>", "Input directory", "./karya-export")
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const inputDir = options.input ?? "./karya-export";
        await context.store.ensureInitialized();

        const warnings: Warning[] = [];
        let imported = 0;
        let conflicted = 0;
        let skipped = 0;

        const [users, tasks, relations] = await Promise.all([
          readJsonItems<User>(inputDir, "users"),
          readJsonItems<Task>(inputDir, "tasks"),
          readJsonItems<TaskRelation>(inputDir, "relations"),
        ]);

        for (const item of users) {
          try {
            await context.backend.users.putUser(item.value);
            imported += 1;
          } catch (error) {
            skipped += 1;
            warnings.push({
              code: "IMPORT_ITEM_FAILED",
              message: `${item.file}: ${String((error as { message?: string }).message ?? error)}`,
            });
          }
        }

        for (const item of tasks) {
          try {
            const result = await context.backend.tasks.putTask(item.value);
            if (result.written) {
              imported += 1;
            } else {
              conflicted += 1;
            }
          } catch (error) {
            skipped += 1;
            warnings.push({
              code: "IMPORT_ITEM_FAILED",
              message: `${item.file}: ${String((error as { message?: string }).message ?? error)}`,
            });
          }
        }

        for (const item of relations) {
          try {
            await context.backend.relations.putRelation(item.value);
            imported += 1;
          } catch (error) {
            skipped += 1;
            warnings.push({
              code: "IMPORT_ITEM_FAILED",
              message: `${item.file}: ${String((error as { message?: string }).message ?? error)}`,
            });
          }
        }

        return {
          ok: true,
          message: `Import complete: ${imported} imported, ${conflicted} conflicted, ${skipped} skipped`,
          data: {
            input: inputDir,
            imported,
            conflicted,
            skipped,
          },
          warnings,
        };
      });
    });
}
