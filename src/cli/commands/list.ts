import { Command } from "commander";
import type { Priority, TaskStatus } from "../../core/schema.js";
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
    .option("-s, --status <statuses>", "Comma-separated statuses")
    .option("-t, --tag <tags>", "Comma-separated tags")
    .option("--owner <alias>", "Owner alias, 'me', or 'none'")
    .option("--assignee <alias>", "Assignee alias, 'me', or 'none'")
    .action(async (filterAlias: string | undefined, options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const aliasConfig = filterAlias ? context.config.filterAliases[filterAlias] : undefined;
        if (filterAlias && !aliasConfig) {
          throw new KaryaError(`Unknown filter alias: ${filterAlias}`, "USAGE");
        }

        const expanded = aliasConfig ? expandFilterAlias(aliasConfig, context.config.author) : {};
        const project = runtime.parseCsv(options.project) ?? expanded.project;
        const priority = (runtime.parseCsv(options.priority) as Priority[] | undefined) ?? expanded.priority;
        const status = (runtime.parseCsv(options.status) as TaskStatus[] | undefined) ?? expanded.status;
        const tag = runtime.parseCsv(options.tag) ?? expanded.tag;
        const ownerRef = options.owner ?? expanded.owner;
        const assigneeRef = options.assignee ?? expanded.assignee;
        const ownerId = await resolveFilterUserId(context, ownerRef);
        const assigneeId = await resolveFilterUserId(context, assigneeRef);

        const tasks = await context.store.listTasks({
          project,
          priority,
          status,
          tag,
          ownerId,
          assigneeId,
          assigneeType: expanded.assigneeType,
        });

        if (context.config.format === "json") {
          return {
            ok: true,
            data: tasks,
          };
        }

        const lines = tasks.map((task) => formatTaskLine(task));
        return {
          ok: true,
          message: lines.length > 0 ? lines.join("\n") : "No tasks found",
        };
      });
    });
}
