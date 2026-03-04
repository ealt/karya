import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { migrateTaskRecord } from "../../core/migrate.js";
import type { Bucket } from "../../core/backend.js";
import type { Task } from "../../core/schema.js";
import type { Warning } from "../../shared/types.js";
import type { CliRuntime } from "../shared/runtime.js";
import { Command } from "commander";

async function readBucketTasks(inputDir: string, bucket: Bucket): Promise<Array<{ task: Task; file: string }>> {
  const dir = join(inputDir, bucket);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const tasks: Array<{ task: Task; file: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const path = join(dir, entry.name);
    const raw = await readFile(path, "utf8");
    tasks.push({ task: migrateTaskRecord(JSON.parse(raw)), file: path });
  }

  return tasks;
}

export function registerImportCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("import")
    .description("Import tasks from JSON files")
    .option("--input <dir>", "Input directory", "./karya-export")
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const inputDir = options.input ?? "./karya-export";
        await context.store.ensureInitialized();

        const warnings: Warning[] = [];

        let imported = 0;
        let conflicted = 0;
        let skipped = 0;

        for (const bucket of ["tasks", "archive"] as const) {
          let items: Array<{ task: Task; file: string }> = [];
          try {
            items = await readBucketTasks(inputDir, bucket);
          } catch (error) {
            warnings.push({
              code: "IMPORT_READ_FAILED",
              message: `Failed to read ${bucket}: ${String((error as { message?: string }).message ?? error)}`,
            });
            continue;
          }

          for (const item of items) {
            try {
              const result = await context.backend.putTask(item.task, bucket);
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
