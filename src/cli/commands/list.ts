import { Command } from "commander";
import type { Priority } from "../../core/schema.js";
import { KaryaError } from "../../core/errors.js";
import { formatTaskLine } from "../formatters/output.js";
import { expandFilterAlias } from "../shared/aliases.js";
import type { CliRuntime, CommandContext } from "../shared/runtime.js";

async function resolveFilterUserId(context: CommandContext, reference: string | undefined): Promise<string | null | undefined> {
  if (reference === undefined) {
    return undefined;
  }
  if (reference === "none") {
    return null;
  }
  if (reference === "me") {
    return (await context.userStore.requireActiveUser(context.config.author)).id;
  }

  return (await context.userStore.resolveUser(reference)).id;
}

export function registerListCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("list")
    .description("List tasks")
    .argument("[filterAlias]", "Configured filter alias")
    .option("-p, --project <projects>", "Comma-separated projects")
    .option("-P, --priority <priorities>", "Comma-separated priorities")
    .option("-t, --tag <tags>", "Comma-separated tags")
    .option("--closed", "Show only closed tasks")
    .option("--all", "Show open and closed tasks")
    .option("--owner <alias>", "Owner alias, 'me', or 'none'")
    .option("--assignee <alias>", "Assignee alias, 'me', or 'none'")
    .action(
      async (filterAlias: string | undefined, options: Record<string, string | boolean | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const aliasConfig = filterAlias ? context.config.filterAliases[filterAlias] : undefined;
        if (filterAlias && !aliasConfig) {
          throw new KaryaError(`Unknown filter alias: ${filterAlias}`, "USAGE");
        }
        if (options.closed === true && options.all === true) {
          throw new KaryaError("Cannot combine --closed with --all.", "USAGE");
        }

        const expanded = aliasConfig ? expandFilterAlias(aliasConfig, context.config.author) : {};
        const project = runtime.parseCsv(typeof options.project === "string" ? options.project : undefined) ?? expanded.project;
        const priority =
          (runtime.parseCsv(typeof options.priority === "string" ? options.priority : undefined) as Priority[] | undefined) ??
          expanded.priority;
        const tag = runtime.parseCsv(typeof options.tag === "string" ? options.tag : undefined) ?? expanded.tag;
        const ownerRef = typeof options.owner === "string" ? options.owner : expanded.owner;
        const assigneeRef = typeof options.assignee === "string" ? options.assignee : expanded.assignee;
        const ownerId = await resolveFilterUserId(context, ownerRef);
        const assigneeId = await resolveFilterUserId(context, assigneeRef);
        const view = options.all === true ? "all" : options.closed === true ? "closed" : "open";

        const tasks = await context.store.listTasks({
          project,
          priority,
          tag,
          ownerId,
          assigneeId,
          assigneeType: expanded.assigneeType,
          view,
        });

        if (context.config.format === "json") {
          return {
            ok: true,
            data: tasks,
          };
        }

        const users = await context.userStore.listUsers(true);
        const aliasMap = new Map(users.map((u) => [u.id, u.alias]));
        const resolveAlias = (id: string) => aliasMap.get(id) ?? id;
        const lines = tasks.map((task) => formatTaskLine(task, resolveAlias));
        return {
          ok: true,
          message: lines.length > 0 ? lines.join("\n") : "No tasks found",
        };
      });
    });
}
