import { Command } from "commander";
import { KaryaError } from "../../core/errors.js";
import type { Priority, TaskStatus } from "../../core/schema.js";
import type { CliRuntime, CommandContext } from "../shared/runtime.js";

async function resolveUserId(
  context: CommandContext,
  reference: string | undefined,
  preserve: symbol,
): Promise<string | null | symbol> {
  if (reference === undefined) {
    return preserve;
  }
  if (reference === "none") {
    return null;
  }

  return (await context.userStore.resolveUser(reference)).id;
}

export function registerEditCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("edit")
    .description("Edit an existing task")
    .argument("<id>", "Task id or prefix")
    .option("--title <title>", "New title")
    .option("-p, --project <project>", "Project")
    .option("-P, --priority <priority>", "Priority")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("-s, --status <status>", "Status")
    .option("--owner <alias>", "Owner alias or 'none'")
    .option("--assignee <alias>", "Assignee alias or 'none'")
    .option("--add-tag <tag>", "Add tag", (value, previous: string[] = []) => [...previous, value])
    .option("--rm-tag <tag>", "Remove tag", (value, previous: string[] = []) => [...previous, value])
    .option("--edit-tag <tag>", "Replace a keyed tag", (value, previous: string[] = []) => [...previous, value])
    .option("--parent <id>", "Set parent relation")
    .option("--blocks <id>", "Add blocks relation")
    .option("--blocked-by <id>", "Add blocked-by relation")
    .option("--note <note>", "Replace note")
    .action(async (id: string, options: Record<string, string | string[] | undefined>, command: Command) => {
      await runtime.runCommand(
        command,
        async (context) => {
          const currentUser = context.currentUser!;
          const preserve = Symbol("preserve");
          const ownerId = await resolveUserId(context, options.owner as string | undefined, preserve);
          const assigneeId = await resolveUserId(context, options.assignee as string | undefined, preserve);
          const hasReplaceTags = typeof options.tags === "string";
          const hasSurgicalTags =
            Array.isArray(options.addTag) || Array.isArray(options.rmTag) || Array.isArray(options.editTag);
          if (hasReplaceTags && hasSurgicalTags) {
            throw new KaryaError("Cannot combine --tags with --add-tag/--rm-tag/--edit-tag.", "USAGE");
          }

          const patch = {
            title: options.title as string | undefined,
            project: options.project as string | undefined,
            priority: options.priority as Priority | undefined,
            status: options.status as TaskStatus | undefined,
            note: options.note as string | undefined,
            ownerId: ownerId === preserve ? undefined : (ownerId as string | null),
            assigneeId: assigneeId === preserve ? undefined : (assigneeId as string | null),
            tags: hasReplaceTags ? runtime.parseCsv(options.tags as string) : undefined,
            addTags: options.addTag as string[] | undefined,
            rmTags: options.rmTag as string[] | undefined,
            editTags: options.editTag as string[] | undefined,
          };

          const hasChanges =
            Object.values(patch).some((value) => value !== undefined) ||
            Boolean(options.parent || options.blocks || options.blockedBy);
          if (!hasChanges) {
            throw new KaryaError("No edits provided.", "USAGE");
          }

          const write = await runtime.runWrite(context, async () => {
            const updated = await context.store.editTask(id, patch, currentUser.id);
            if (typeof options.parent === "string") {
              await context.store.addRelation(updated.id, options.parent, "parent");
            }
            if (typeof options.blocks === "string") {
              await context.store.addRelation(updated.id, options.blocks, "blocks");
            }
            if (typeof options.blockedBy === "string") {
              await context.store.addRelation(options.blockedBy, updated.id, "blocks");
            }
            return updated;
          });

          return {
            ok: true,
            message: `Updated ${write.result.id}`,
            data: write.result,
            warnings: write.warnings,
          };
        },
        { requireActiveUser: true },
      );
    });
}
