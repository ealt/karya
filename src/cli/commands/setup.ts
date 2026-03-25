import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { userInfo } from "node:os";
import { Command } from "commander";
import { saveAppConfig, type OutputFormat, defaultDbPath } from "../../core/config.js";
import { createBackend } from "../../core/create-backend.js";
import { KaryaError } from "../../core/errors.js";
import type { BackendConfig, UserType } from "../../core/schema.js";
import { UserStore } from "../../core/user-store.js";
import { render } from "../formatters/output.js";
import type { CliRuntime } from "../shared/runtime.js";

interface SetupOptions {
  backendType?: string;
  dbPath?: string;
  connectionString?: string;
  ssl?: string;
  name?: string;
  alias?: string;
  type?: string;
}

function getFormat(command: Command): OutputFormat {
  const opts = command.optsWithGlobals<Record<string, unknown>>();
  return opts.format === "json" ? "json" : "human";
}

async function buildBackendConfig(options: SetupOptions): Promise<BackendConfig> {
  const backendType = options.backendType === "pg" ? "pg" : "sqlite";
  if (backendType === "sqlite") {
    return {
      type: "sqlite",
      dbPath: options.dbPath ?? defaultDbPath(),
    };
  }

  if (!options.connectionString) {
    throw new KaryaError("PostgreSQL setup requires --connection-string", "USAGE");
  }

  return {
    type: "pg",
    connectionString: options.connectionString,
    ssl: options.ssl === "off" ? "off" : "verify-full",
  };
}

async function promptIfMissing(options: SetupOptions): Promise<Required<Pick<SetupOptions, "backendType" | "alias">> & SetupOptions> {
  if (!process.stdin.isTTY) {
    if (!options.alias) {
      throw new KaryaError("Non-interactive setup requires --alias", "USAGE");
    }
    return {
      backendType: options.backendType ?? "sqlite",
      alias: options.alias,
      ...options,
    };
  }

  const rl = createInterface({ input, output });
  try {
    const backendType = options.backendType ?? ((await rl.question("Backend type (sqlite/pg) [sqlite]: ")) || "sqlite");
    const alias = options.alias ?? (await rl.question("Alias: "));
    if (!alias.trim()) {
      throw new KaryaError("Alias is required", "USAGE");
    }

    const next: SetupOptions = { ...options, backendType, alias };
    if (backendType !== "pg" && !next.dbPath) {
      next.dbPath = (await rl.question(`SQLite db path [${defaultDbPath()}]: `)) || defaultDbPath();
    }
    if (backendType === "pg" && !next.connectionString) {
      next.connectionString = await rl.question("PostgreSQL connection string: ");
    }

    return {
      backendType,
      alias,
      ...next,
    };
  } finally {
    rl.close();
  }
}

export function registerSetupCommand(program: Command, _runtime: CliRuntime): void {
  program
    .command("setup")
    .description("Configure backend and current user")
    .option("--backend-type <type>", "sqlite or pg")
    .option("--db-path <path>", "SQLite database path")
    .option("--connection-string <value>", "PostgreSQL connection string")
    .option("--ssl <mode>", "PostgreSQL SSL mode")
    .option("--name <name>", "New user display name")
    .option("--alias <alias>", "User alias")
    .option("--type <type>", "New user type")
    .action(async (options: SetupOptions, command: Command) => {
      const format = getFormat(command);
      const globals = command.optsWithGlobals<Record<string, unknown>>();
      const mergedOptions: SetupOptions = {
        ...options,
        dbPath: options.dbPath ?? (typeof globals.dbPath === "string" ? globals.dbPath : undefined),
      };
      let backend = null;

      try {
        const resolved = await promptIfMissing(mergedOptions);
        const backendConfig = await buildBackendConfig(resolved);
        await saveAppConfig({ backend: backendConfig });

        backend = await createBackend(backendConfig);
        await backend.initialize();
        const userStore = new UserStore(backend);

        const alias = resolved.alias!.trim();
        let user = await backend.users.getUserByAlias(alias);
        if (user?.deactivatedAt) {
          throw new KaryaError(`User is deactivated: ${alias}`, "INVALID_STATE");
        }

        if (!user) {
          if (!resolved.name) {
            if (!process.stdin.isTTY) {
              throw new KaryaError(`Alias not found: ${alias}. Provide --name to create it.`, "USAGE");
            }

            const rl = createInterface({ input, output });
            try {
              const createAnswer = (await rl.question(`Alias '${alias}' not found. Create it? [y/N]: `)).trim().toLowerCase();
              if (createAnswer !== "y" && createAnswer !== "yes") {
                throw new KaryaError(`Alias not found: ${alias}`, "NOT_FOUND");
              }

              const name = (await rl.question(`Name [${userInfo().username}]: `)).trim() || userInfo().username;
              const type = ((await rl.question("Type (human/agent) [human]: ")).trim() || "human") as UserType;
              user = await userStore.addUser({ name, alias, type });
            } finally {
              rl.close();
            }
          } else {
            user = await userStore.addUser({
              name: resolved.name,
              alias,
              type: (resolved.type as UserType | undefined) ?? "human",
            });
          }
        }

        await saveAppConfig({ backend: backendConfig, author: user.alias });

        render(
          {
            ok: true,
            message: `Configured ${user.alias}`,
            data: {
              backend: backendConfig,
              author: user.alias,
            },
          },
          format,
        );
      } catch (error) {
        render(
          {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          },
          format,
        );
        process.exitCode = 1;
      } finally {
        if (backend) {
          await backend.close();
        }
      }
    });
}
