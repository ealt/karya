import { Command } from "commander";
import { type OutputFormat, type ResolveConfigOptions, resolveConfig } from "../../core/config.js";
import { createBackend } from "../../core/create-backend.js";
import { KaryaError } from "../../core/errors.js";
import { TaskStore } from "../../core/task-store.js";
import { UserStore } from "../../core/user-store.js";
import type { Warning } from "../../shared/types.js";
import { render, type CommandOutput } from "../formatters/output.js";
import type { DbBackend } from "../../core/backend.js";
import type { User } from "../../core/schema.js";

export interface CommandContext {
  config: Awaited<ReturnType<typeof resolveConfig>>;
  store: TaskStore;
  userStore: UserStore;
  backend: DbBackend;
  currentUser: User | null;
}

export interface RunCommandOptions {
  requireActiveUser?: boolean;
}

export interface CliRuntime {
  parseCsv(input?: string): string[] | undefined;
  runCommand(
    commandLike: unknown,
    handler: (context: CommandContext) => Promise<CommandOutput>,
    options?: RunCommandOptions,
  ): Promise<void>;
  runWrite<T>(context: CommandContext, operation: () => Promise<T>): Promise<{ result: T; warnings: Warning[] }>;
}

function parseGlobalOptionsFromArgv(argv: string[]): ResolveConfigOptions {
  const parsed: ResolveConfigOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--db-path" && index + 1 < argv.length) {
      parsed.dbPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--db-path=")) {
      parsed.dbPath = token.split("=", 2)[1];
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
  let opts: Record<string, unknown>;
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
    dbPath: argvParsed.dbPath ?? (typeof opts.dbPath === "string" ? opts.dbPath : undefined),
    format: argvParsed.format ?? (format === "json" || format === "human" ? format : undefined),
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

export function createCliRuntime(program: Command): CliRuntime {
  return {
    parseCsv,

    async runCommand(commandLike, handler, options = {}) {
      const globalOptions = getGlobalOptions(program, commandLike);
      let format: OutputFormat = globalOptions.format ?? "human";
      let backend: DbBackend | null = null;

      try {
        const config = await resolveConfig(globalOptions);
        format = config.format;

        backend = await createBackend(config.backend);
        const store = new TaskStore(backend);
        const userStore = new UserStore(backend);

        let currentUser: User | null = null;
        if (options.requireActiveUser) {
          try {
            currentUser = await userStore.requireActiveUser(config.author);
          } catch {
            throw new KaryaError("No user configured. Run `karya setup` first.", "INVALID_STATE");
          }
        }

        const output = await handler({ config, store, userStore, backend, currentUser });
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
      } finally {
        if (backend) {
          await backend.close();
        }
      }
    },

    async runWrite(_context, operation) {
      const result = await operation();
      return {
        result,
        warnings: [],
      };
    },
  };
}
