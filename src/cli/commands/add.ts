import { Command } from "commander";
import type { Priority } from "../../core/schema.js";
import type { CliRuntime, CommandContext } from "../shared/runtime.js";

async function resolveUserId(
  context: CommandContext,
  reference: string | undefined,
  fallbackId: string | null,
): Promise<string | null> {
  if (reference === undefined) {
    return fallbackId;
  }
  if (reference === "none") {
    return null;
  }

  return (await context.userStore.resolveUser(reference)).id;
}

export function registerAddCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("add")
    .description("Add a new task")
    .argument("<title>", "Task title")
    .option("-p, --project <project>", "Task project")
    .option("-P, --priority <priority>", "Priority P0-P3")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--parent <id>", "Parent task id")
    .option("--owner <alias>", "Owner alias or 'none'")
    .option("--assignee <alias>", "Assignee alias or 'none'")
    .option("--note <note>", "Task note")
    .action(async (title: string, options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(
        command,
        async (context) => {
          const ownerId = await resolveUserId(context, options.owner, null);
          const assigneeId = await resolveUserId(context, options.assignee, null);
          const tags = Array.from(new Set([...(runtime.parseCsv(options.tags) ?? []), ...context.config.autoTags]));

          const write = await runtime.runWrite(context, async () =>
            context.store.addTask(
              {
                title,
                project: options.project,
                tags,
                priority: options.priority as Priority | undefined,
                parentId: options.parent,
                ownerId: ownerId ?? undefined,
                assigneeId: assigneeId ?? undefined,
                note: options.note,
              },
              {
                project: context.config.defaultProject,
                priority: context.config.defaultPriority,
              },
            ),
          );

          return {
            ok: true,
            message: `Added ${write.result.id}`,
            data: write.result,
            warnings: write.warnings,
          };
        },
      );
    });
}
