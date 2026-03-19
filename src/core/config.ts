import { access, chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { KaryaError } from "./errors.js";
import { isOpReference, resolveOpReference } from "./op-resolve.js";
import { AppConfigSchema, type AppConfig, type BackendConfig, type Priority } from "./schema.js";
import { DEFAULT_BACKEND_TYPE, DEFAULT_FORMAT, DEFAULT_PRIORITY, DEFAULT_PROJECT } from "../shared/constants.js";

export type OutputFormat = "human" | "json";

export interface ResolveConfigOptions {
  dataDir?: string;
  dbPath?: string;
  backendType?: "sqlite" | "pg";
  connectionString?: string;
  ssl?: "verify-full" | "off";
  sslCaPath?: string;
  format?: OutputFormat;
  author?: string;
  skipLegacyCheck?: boolean;
}

export interface ResolvedConfig {
  backend: BackendConfig;
  format: OutputFormat;
  author: string;
  defaultProject: string;
  defaultPriority: Priority;
  appConfigPath: string;
  skipLegacyCheck: boolean;
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function parseBool(input: string | undefined): boolean | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  return undefined;
}

function parseBackendType(input: string | undefined): "sqlite" | "pg" | undefined {
  if (input === "sqlite" || input === "pg") {
    return input;
  }

  return undefined;
}

function parseSslMode(input: string | undefined): "verify-full" | "off" | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = input.trim().toLowerCase();
  if (value === "verify-full" || value === "off") {
    return value;
  }

  throw new KaryaError(`Invalid KARYA_PG_SSL value: ${input}`, "CONFIG");
}

function parseFormat(input: string | undefined): OutputFormat | undefined {
  if (input === "human" || input === "json") {
    return input;
  }

  return undefined;
}

function sqliteBackend(dbPath: string): BackendConfig {
  return {
    type: "sqlite",
    dbPath: expandHome(dbPath),
  };
}

export function defaultDbPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "karya", "karya.db");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "karya", "karya.db");
  }

  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "karya", "karya.db");
}

export function getAppConfigPath(): string {
  return join(homedir(), ".config", "karya", "karya.json");
}

const DEFAULT_APP_CONFIG: AppConfig = {
  backend: sqliteBackend(defaultDbPath()),
  defaultProject: DEFAULT_PROJECT,
  defaultPriority: DEFAULT_PRIORITY,
  author: "cli",
};

function migrateLegacyConfig(parsed: Record<string, unknown>): Record<string, unknown> {
  const next = { ...parsed };

  if (!("backend" in next) && typeof next.dataDir === "string" && next.dataDir.length > 0) {
    next.backend = sqliteBackend(join(expandHome(next.dataDir), "karya.db"));
  }

  delete next.dataDir;
  delete next.autoSync;
  delete next.web;

  return next;
}

export async function loadAppConfig(path = getAppConfigPath()): Promise<AppConfig> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const migrated = migrateLegacyConfig(parsed);
    const merged = { ...DEFAULT_APP_CONFIG, ...migrated };

    return AppConfigSchema.parse(merged);
  } catch {
    return { ...DEFAULT_APP_CONFIG };
  }
}

export async function saveAppConfig(patch: Record<string, unknown>, path = getAppConfigPath()): Promise<void> {
  const current = await loadAppConfig(path);
  const updated = { ...current, ...patch };

  const validated = AppConfigSchema.parse(updated);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  try {
    await chmod(path, 0o600);
  } catch {
    // Ignore unsupported chmod platforms and permission errors.
  }
}

export async function setAppConfigValue(key: string, value: string): Promise<void> {
  const current = await loadAppConfig();

  if (key === "author" || key === "defaultProject" || key === "defaultPriority") {
    await saveAppConfig({ [key]: value });
    return;
  }

  if (key === "backend.type") {
    if (value === "sqlite") {
      const existingPath =
        current.backend?.type === "sqlite" && current.backend.dbPath.length > 0
          ? current.backend.dbPath
          : defaultDbPath();
      await saveAppConfig({ backend: sqliteBackend(existingPath) });
      return;
    }

    if (value === "pg") {
      if (current.backend?.type === "pg") {
        await saveAppConfig({
          backend: {
            type: "pg",
            connectionString: current.backend.connectionString,
            ssl: current.backend.ssl,
            sslCaPath: current.backend.sslCaPath,
          },
        });
        return;
      }

      throw new KaryaError("Set backend.connectionString before switching backend.type to pg", "CONFIG");
    }

    throw new KaryaError(`Invalid backend.type: ${value}`, "CONFIG");
  }

  if (key === "backend.dbPath") {
    await saveAppConfig({ backend: sqliteBackend(value) });
    return;
  }

  if (key === "backend.connectionString") {
    await saveAppConfig({
      backend: {
        type: "pg",
        connectionString: value,
        ssl: current.backend?.type === "pg" ? current.backend.ssl : "verify-full",
        sslCaPath: current.backend?.type === "pg" ? current.backend.sslCaPath : undefined,
      },
    });
    return;
  }

  if (key === "backend.ssl") {
    if (current.backend?.type !== "pg") {
      throw new KaryaError("backend.ssl only applies to pg backend; set backend.connectionString first", "CONFIG");
    }

    if (value !== "verify-full" && value !== "off") {
      throw new KaryaError(`Invalid backend.ssl: ${value}`, "CONFIG");
    }

    await saveAppConfig({
      backend: {
        type: "pg",
        connectionString: current.backend.connectionString,
        ssl: value,
        sslCaPath: current.backend.sslCaPath,
      },
    });
    return;
  }

  if (key === "backend.sslCaPath") {
    if (current.backend?.type !== "pg") {
      throw new KaryaError("backend.sslCaPath only applies to pg backend; set backend.connectionString first", "CONFIG");
    }

    const sslCaPath = value.trim().length > 0 ? expandHome(value) : undefined;
    await saveAppConfig({
      backend: {
        type: "pg",
        connectionString: current.backend.connectionString,
        ssl: current.backend.ssl,
        sslCaPath,
      },
    });
    return;
  }

  if (key === "dataDir") {
    await saveAppConfig({ backend: sqliteBackend(join(expandHome(value), "karya.db")) });
    return;
  }

  throw new KaryaError(`Unknown config key: ${key}`, "CONFIG");
}

function resolveSqlitePath(options: ResolveConfigOptions, appConfig: AppConfig): string {
  if (typeof options.dbPath === "string" && options.dbPath.length > 0) {
    return expandHome(options.dbPath);
  }

  if (typeof options.dataDir === "string" && options.dataDir.length > 0) {
    return join(expandHome(options.dataDir), "karya.db");
  }

  if (typeof process.env.KARYA_DB_PATH === "string" && process.env.KARYA_DB_PATH.length > 0) {
    return expandHome(process.env.KARYA_DB_PATH);
  }

  if (typeof process.env.KARYA_DATA_DIR === "string" && process.env.KARYA_DATA_DIR.length > 0) {
    return join(expandHome(process.env.KARYA_DATA_DIR), "karya.db");
  }

  if (appConfig.backend?.type === "sqlite") {
    return expandHome(appConfig.backend.dbPath);
  }

  return defaultDbPath();
}

export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<ResolvedConfig> {
  const env = process.env;
  const appConfigPath = getAppConfigPath();
  const appConfig = await loadAppConfig(appConfigPath);

  const backendType = options.backendType ?? parseBackendType(env.KARYA_BACKEND) ?? appConfig.backend?.type ?? DEFAULT_BACKEND_TYPE;

  let backend: BackendConfig;
  if (backendType === "sqlite") {
    backend = sqliteBackend(resolveSqlitePath(options, appConfig));
  } else {
    let connectionString =
      options.connectionString ??
      env.KARYA_PG_CONNECTION_STRING ??
      (appConfig.backend?.type === "pg" ? appConfig.backend.connectionString : undefined);

    if (!connectionString) {
      throw new KaryaError("PostgreSQL backend requires connection string", "CONFIG");
    }

    if (isOpReference(connectionString)) {
      connectionString = await resolveOpReference(connectionString);
    }

    const ssl =
      options.ssl ??
      parseSslMode(env.KARYA_PG_SSL) ??
      (appConfig.backend?.type === "pg" ? appConfig.backend.ssl : undefined) ??
      "verify-full";

    const sslCaPathRaw =
      options.sslCaPath ??
      env.KARYA_PG_SSL_CA ??
      (appConfig.backend?.type === "pg" ? appConfig.backend.sslCaPath : undefined);

    backend = {
      type: "pg",
      connectionString,
      ssl,
      sslCaPath: sslCaPathRaw ? expandHome(sslCaPathRaw) : undefined,
    };
  }

  return {
    backend,
    format: options.format ?? parseFormat(env.KARYA_FORMAT) ?? (DEFAULT_FORMAT as OutputFormat),
    author: options.author ?? env.KARYA_AUTHOR ?? appConfig.author,
    defaultProject: appConfig.defaultProject,
    defaultPriority: appConfig.defaultPriority,
    appConfigPath,
    skipLegacyCheck: options.skipLegacyCheck ?? parseBool(env.KARYA_SKIP_LEGACY_CHECK) ?? false,
  };
}

export async function detectLegacyData(config: ResolvedConfig): Promise<string | null> {
  if (config.backend.type !== "sqlite") {
    return null;
  }

  const oldTasksDir = join(dirname(config.backend.dbPath), "tasks");
  try {
    await access(oldTasksDir, fsConstants.F_OK);
    const entries = await readdir(oldTasksDir, { withFileTypes: true });
    const hasJsonTasks = entries.some((entry) => entry.isFile() && entry.name.endsWith(".json"));

    if (!hasJsonTasks) {
      return null;
    }

    return [
      "Legacy JSON task data detected.",
      `Found: ${oldTasksDir}`,
      "Run migration import before continuing:",
      `  karya --db-path ${config.backend.dbPath} --skip-legacy-check import --input ${join(dirname(config.backend.dbPath))}`,
    ].join("\n");
  } catch {
    return null;
  }
}
