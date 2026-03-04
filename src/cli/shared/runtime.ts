import { Command } from "commander";
import { type OutputFormat, type ResolveConfigOptions, resolveConfig } from "../../core/config.js";
import { KaryaError } from "../../core/errors.js";
import { GitSync, type SyncWarning } from "../../core/git-sync.js";
import { TaskStore } from "../../core/task-store.js";
import { render, type CommandOutput } from "../formatters/output.js";

export interface CommandContext {
  config: Awaited<ReturnType<typeof resolveConfig>>;
  store: TaskStore;
  sync: GitSync;
}

export interface CliRuntime {
  parseCsv(input?: string): string[] | undefined;
  runCommand(commandLike: unknown, handler: (context: CommandContext) => Promise<CommandOutput>): Promise<void>;
  runWrite<T>(
    context: CommandContext,
    operation: () => Promise<T>,
    commitMessage: string,
  ): Promise<{ result: T; warnings: SyncWarning[] }>;
}

function parseGlobalOptionsFromArgv(argv: string[]): ResolveConfigOptions {
  const parsed: ResolveConfigOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--no-sync") {
      parsed.noSync = true;
      continue;
    }

    if (token === "--data-dir" && index + 1 < argv.length) {
      parsed.dataDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--data-dir=")) {
      parsed.dataDir = token.split("=", 2)[1];
      continue;
    }

    if (token === "--format" && index + 1 < argv.length) {
      const value = argv[index + 1];
      if (value === "json" || value === "human") {
        parsed.format = value;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--format=")) {
      const value = token.split("=", 2)[1];
      if (value === "json" || value === "human") {
        parsed.format = value;
      }
      continue;
    }

    if (token === "--author" && index + 1 < argv.length) {
      parsed.author = argv[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--author=")) {
      parsed.author = token.split("=", 2)[1];
      continue;
    }
  }

  return parsed;
}

function getGlobalOptions(program: Command, commandLike: unknown): ResolveConfigOptions {
  let opts: Record<string, unknown> = {};

  if (
    commandLike &&
    typeof commandLike === "object" &&
    "optsWithGlobals" in commandLike &&
    typeof (commandLike as { optsWithGlobals?: unknown }).optsWithGlobals === "function"
  ) {
    opts = (commandLike as { optsWithGlobals: () => Record<string, unknown> }).optsWithGlobals();
  } else if (
    commandLike &&
    typeof commandLike === "object" &&
    "parent" in commandLike &&
    (commandLike as { parent?: unknown }).parent &&
    typeof ((commandLike as { parent: { optsWithGlobals?: unknown } }).parent.optsWithGlobals) === "function"
  ) {
    opts = (commandLike as { parent: { optsWithGlobals: () => Record<string, unknown> } }).parent.optsWithGlobals();
  } else {
    opts = program.opts<Record<string, unknown>>();
  }

  const format = opts.format;
  const argvParsed = parseGlobalOptionsFromArgv(process.argv.slice(2));

  return {
    dataDir: argvParsed.dataDir ?? (typeof opts.dataDir === "string" ? opts.dataDir : undefined),
    format: argvParsed.format ?? (format === "json" || format === "human" ? format : undefined),
    noSync: argvParsed.noSync ?? (typeof opts.noSync === "boolean" ? opts.noSync : undefined),
    author: argvParsed.author ?? (typeof opts.author === "string" ? opts.author : undefined),
  };
}

function parseCsv(input?: string): string[] | undefined {
  if (!input) {
    return undefined;
  }

  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof KaryaError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toConflictWarning(result: unknown): SyncWarning[] {
  if (!result || typeof result !== "object") {
    return [];
  }

  if (!("id" in result) || !("conflicts" in result)) {
    return [];
  }

  const id = (result as { id?: unknown }).id;
  const conflicts = (result as { conflicts?: unknown }).conflicts;

  if (typeof id !== "string" || !Array.isArray(conflicts) || conflicts.length === 0) {
    return [];
  }

  return [
    {
      code: "CONFLICT",
      message: `Task ${id} includes ${conflicts.length} conflict marker(s).`,
    },
  ];
}

export function createCliRuntime(program: Command): CliRuntime {
  return {
    parseCsv,

    async runCommand(commandLike, handler) {
      const globalOptions = getGlobalOptions(program, commandLike);
      let format: OutputFormat = globalOptions.format ?? "human";

      try {
        const config = await resolveConfig(globalOptions);
        format = config.format;
        const store = new TaskStore(config.dataDir);
        const sync = new GitSync(config.dataDir, config.author);

        const output = await handler({ config, store, sync });
        render(output, format);
      } catch (error) {
        render(
          {
            ok: false,
            message: toErrorMessage(error),
          },
          format,
        );
        process.exitCode = 1;
      }
    },

    async runWrite(context, operation, commitMessage) {
      if (context.config.noSync || !context.config.autoSync) {
        const result = await operation();
        return {
          result,
          warnings: toConflictWarning(result),
        };
      }

      const output = await context.sync.runWriteCycle(operation, commitMessage, context.config.syncRetries);
      return {
        result: output.result,
        warnings: [...output.sync.warnings, ...toConflictWarning(output.result)],
      };
    },
  };
}
