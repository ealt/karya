import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_BACKEND_TYPE, DEFAULT_FORMAT, DEFAULT_PRIORITY, DEFAULT_PROJECT } from "../shared/constants.js";
import { KaryaError } from "./errors.js";
import { isOpReference, resolveOpReference } from "./op-resolve.js";
import {
  AppConfigSchema,
  type AppConfig,
  type BackendConfig,
  type FilterAliasValue,
  type Priority,
} from "./schema.js";

export type OutputFormat = "human" | "json";

export interface ResolveConfigOptions {
  dbPath?: string;
  backendType?: "sqlite" | "pg";
  connectionString?: string;
  ssl?: "verify-full" | "off";
  sslCaPath?: string;
  format?: OutputFormat;
  author?: string;
}

export interface ResolvedConfig {
  backend: BackendConfig;
  format: OutputFormat;
  author: string;
  defaultProject: string;
  defaultPriority: Priority;
  autoTags: string[];
  filterAliases: Record<string, FilterAliasValue>;
  appConfigPath: string;
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }

  return path;
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
  autoTags: [],
  filterAliases: {},
};

export async function loadAppConfig(path = getAppConfigPath()): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { ...DEFAULT_APP_CONFIG };
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const merged = { ...DEFAULT_APP_CONFIG, ...parsed };
  return AppConfigSchema.parse(merged);
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
    // Best effort only.
  }
}

function updateNestedObject(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) {
    return target;
  }

  if (path.length === 1) {
    return {
      ...target,
      [path[0]]: value,
    };
  }

  const [head, ...rest] = path;
  const current = target[head];
  const next = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};

  return {
    ...target,
    [head]: updateNestedObject(next, rest, value),
  };
}

export async function setAppConfigValue(key: string, value: string): Promise<void> {
  const current = await loadAppConfig();

  if (key === "author" || key === "defaultProject" || key === "defaultPriority") {
    await saveAppConfig({ [key]: value });
    return;
  }

  if (key === "autoTags") {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new KaryaError("autoTags must be a JSON array of strings", "CONFIG");
    }

    await saveAppConfig({ autoTags: parsed });
    return;
  }

  if (key.startsWith("filterAliases.")) {
    const name = key.slice("filterAliases.".length).trim();
    if (!name) {
      throw new KaryaError("filterAliases key must include an alias name", "CONFIG");
    }

    const parsed = JSON.parse(value) as unknown;
    const nextAliases = updateNestedObject(current.filterAliases as Record<string, unknown>, [name], parsed);
    await saveAppConfig({ filterAliases: nextAliases });
    return;
  }

  if (key === "backend.type") {
    if (value === "sqlite") {
      const existingPath =
        current.backend?.type === "sqlite" && current.backend.dbPath.length > 0 ? current.backend.dbPath : defaultDbPath();
      await saveAppConfig({ backend: sqliteBackend(existingPath) });
      return;
    }

    if (value === "pg") {
      if (current.backend?.type !== "pg") {
        throw new KaryaError("Set backend.connectionString before switching backend.type to pg", "CONFIG");
      }

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

    await saveAppConfig({
      backend: {
        type: "pg",
        connectionString: current.backend.connectionString,
        ssl: current.backend.ssl,
        sslCaPath: value.trim() ? expandHome(value) : undefined,
      },
    });
    return;
  }

  throw new KaryaError(`Unknown config key: ${key}`, "CONFIG");
}

function resolveSqlitePath(options: ResolveConfigOptions, appConfig: AppConfig): string {
  if (typeof options.dbPath === "string" && options.dbPath.length > 0) {
    return expandHome(options.dbPath);
  }

  if (typeof process.env.KARYA_DB_PATH === "string" && process.env.KARYA_DB_PATH.length > 0) {
    return expandHome(process.env.KARYA_DB_PATH);
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
    format: options.format ?? parseFormat(env.KARYA_FORMAT) ?? DEFAULT_FORMAT,
    author: options.author ?? env.KARYA_AUTHOR ?? appConfig.author,
    defaultProject: appConfig.defaultProject,
    defaultPriority: appConfig.defaultPriority,
    autoTags: appConfig.autoTags,
    filterAliases: appConfig.filterAliases,
    appConfigPath,
  };
}
