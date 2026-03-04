import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppConfigSchema, RepoConfigSchema, type AppConfig, type Priority, type RepoConfig } from "./schema.js";
import { migrateRepoConfig } from "./migrate.js";
import { DEFAULT_DATA_DIR, DEFAULT_FORMAT, DEFAULT_PRIORITY, DEFAULT_PROJECT } from "../shared/constants.js";

export type OutputFormat = "human" | "json";

export interface ResolveConfigOptions {
  dataDir?: string;
  format?: OutputFormat;
  noSync?: boolean;
  author?: string;
}

export interface ResolvedConfig {
  dataDir: string;
  format: OutputFormat;
  noSync: boolean;
  autoSync: boolean;
  author: string;
  webPort: number;
  defaultProject: string;
  defaultPriority: Priority;
  syncRetries: number;
  fetchIntervalSeconds: number;
  appConfigPath: string;
  repoConfigPath: string;
}

const DEFAULT_APP_CONFIG: AppConfig = {
  dataDir: DEFAULT_DATA_DIR,
  defaultProject: DEFAULT_PROJECT,
  defaultPriority: DEFAULT_PRIORITY,
  autoSync: true,
  author: "cli",
  web: { port: 3000 },
};

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

function parseFormat(input: string | undefined): OutputFormat | undefined {
  if (input === "human" || input === "json") {
    return input;
  }
  return undefined;
}

export function getAppConfigPath(): string {
  return join(homedir(), ".config", "karya", "karya.json");
}

export async function loadAppConfig(path = getAppConfigPath()): Promise<AppConfig> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_APP_CONFIG, ...parsed, web: { ...DEFAULT_APP_CONFIG.web, ...(parsed.web ?? {}) } };
    return AppConfigSchema.parse(merged);
  } catch {
    return { ...DEFAULT_APP_CONFIG };
  }
}

export async function saveAppConfig(patch: Record<string, unknown>, path = getAppConfigPath()): Promise<void> {
  const current = await loadAppConfig(path);
  const updated = {
    ...current,
    ...patch,
    web: {
      ...current.web,
      ...(typeof patch.web === "object" && patch.web ? (patch.web as Record<string, unknown>) : {}),
    },
  };

  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
}

export function getRepoConfigPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export async function loadRepoConfig(dataDir: string): Promise<RepoConfig> {
  try {
    const raw = await readFile(getRepoConfigPath(dataDir), "utf8");
    return migrateRepoConfig(JSON.parse(raw));
  } catch {
    return RepoConfigSchema.parse({});
  }
}

export async function initDataRepo(dataDir: string, author = "cli"): Promise<void> {
  const expanded = expandHome(dataDir);
  await mkdir(join(expanded, "tasks"), { recursive: true });
  await mkdir(join(expanded, "archive"), { recursive: true });
  await mkdir(join(expanded, "projects"), { recursive: true });

  const repoConfigPath = getRepoConfigPath(expanded);
  try {
    await access(repoConfigPath, fsConstants.F_OK);
  } catch {
    const repoDefaults = RepoConfigSchema.parse({});
    await writeFile(repoConfigPath, `${JSON.stringify(repoDefaults, null, 2)}\n`, "utf8");
  }

  try {
    await saveAppConfig({ dataDir: expanded, author });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") {
      throw error;
    }
  }
}

export async function setAppConfigValue(key: string, value: string): Promise<void> {
  if (key === "web.port") {
    await saveAppConfig({ web: { port: Number(value) } });
    return;
  }

  if (["dataDir", "defaultProject", "defaultPriority", "author"].includes(key)) {
    await saveAppConfig({ [key]: value });
    return;
  }

  if (key === "autoSync") {
    await saveAppConfig({ autoSync: parseBool(value) ?? true });
    return;
  }

  throw new Error(`Unknown config key: ${key}`);
}

export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<ResolvedConfig> {
  const env = process.env;
  const appConfigPath = getAppConfigPath();
  const appConfig = await loadAppConfig(appConfigPath);

  const dataDir = expandHome(options.dataDir ?? env.KARYA_DATA_DIR ?? appConfig.dataDir ?? DEFAULT_DATA_DIR);
  const repoConfigPath = getRepoConfigPath(dataDir);
  const repoConfig = await loadRepoConfig(dataDir);

  const format = options.format ?? parseFormat(env.KARYA_FORMAT) ?? (DEFAULT_FORMAT as OutputFormat);
  const noSync = options.noSync ?? parseBool(env.KARYA_NO_SYNC) ?? false;

  const autoSync = appConfig.autoSync ?? repoConfig.autoSync;

  return {
    dataDir,
    format,
    noSync,
    autoSync,
    author: options.author ?? env.KARYA_AUTHOR ?? appConfig.author,
    webPort: appConfig.web.port,
    defaultProject: appConfig.defaultProject ?? repoConfig.defaultProject,
    defaultPriority: appConfig.defaultPriority ?? repoConfig.defaultPriority,
    syncRetries: repoConfig.syncRetries,
    fetchIntervalSeconds: repoConfig.fetchIntervalSeconds,
    appConfigPath,
    repoConfigPath,
  };
}
