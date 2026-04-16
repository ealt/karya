import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppConfigPath, loadAppConfig, resolveConfig, setAppConfigValue } from "../../src/core/config.js";
import { KaryaError } from "../../src/core/errors.js";

const mockState = vi.hoisted(() => {
  const resolveOpReferenceMock = vi.fn();
  return { resolveOpReferenceMock };
});

vi.mock("../../src/core/op-resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/op-resolve.js")>();
  return {
    ...actual,
    resolveOpReference: mockState.resolveOpReferenceMock,
  };
});

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "KARYA_BACKEND",
  "KARYA_PG_CONNECTION_STRING",
  "KARYA_PG_SSL",
  "KARYA_PG_SSL_CA",
  "KARYA_DB_PATH",
  "KARYA_FORMAT",
  "KARYA_AUTHOR",
] as const;

let snapshot: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(async () => {
  snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
    (typeof ENV_KEYS)[number],
    string | undefined
  >;

  const root = await mkdtemp(join(tmpdir(), "karya-config-test-"));
  const homeDir = join(root, "home");
  await mkdir(homeDir, { recursive: true });
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  for (const key of ENV_KEYS) {
    if (key !== "HOME" && key !== "USERPROFILE") {
      delete process.env[key];
    }
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("resolveConfig", () => {
  it("hard-fails on invalid KARYA_PG_SSL values", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "postgresql://localhost/karya";
    process.env.KARYA_PG_SSL = "banana";

    await expect(resolveConfig()).rejects.toThrow("Invalid KARYA_PG_SSL value: banana");
  });

  it("resolves app config alias fields", async () => {
    await setAppConfigValue("autoTags", '["cli"]');
    await setAppConfigValue("filterAliases.mine", '{"owner":"me"}');

    const config = await resolveConfig();

    expect(config.autoTags).toEqual(["cli"]);
    expect(config.filterAliases.mine).toEqual({ owner: "me" });
  });

  it("resolves op:// connection string from env var", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "op://vault/pg/connstring";
    mockState.resolveOpReferenceMock.mockResolvedValueOnce("postgresql://resolved@host/db");

    const config = await resolveConfig();

    expect(config.backend.type).toBe("pg");
    if (config.backend.type !== "pg") {
      throw new Error("expected pg");
    }
    expect(config.backend.connectionString).toBe("postgresql://resolved@host/db");
  });

  it("writes config files with restrictive permissions", async () => {
    await setAppConfigValue("backend.connectionString", "postgresql://localhost/karya");
    await setAppConfigValue("backend.ssl", "off");

    if (process.platform !== "win32") {
      const mode = (await stat(getAppConfigPath())).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("loads app config with new fields", async () => {
    const configPath = getAppConfigPath();
    await mkdir(join(process.env.HOME as string, ".config", "karya"), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          backend: {
            type: "pg",
            connectionString: "postgresql://localhost/custom",
            ssl: "off",
          },
          author: "ealt",
          autoTags: ["cli"],
          filterAliases: {
            mine: { owner: "me" },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadAppConfig(configPath);
    expect(config.author).toBe("ealt");
    expect(config.autoTags).toEqual(["cli"]);
    expect(config.filterAliases.mine).toEqual({ owner: "me" });
  });

  it("throws on invalid config values instead of silently falling back", async () => {
    const configPath = getAppConfigPath();
    await mkdir(join(process.env.HOME as string, ".config", "karya"), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({ backend: { type: "pg", connectionString: "postgresql://localhost/db", ssl: "verify-ca" } }),
      "utf8",
    );

    await expect(loadAppConfig(configPath)).rejects.toThrow();
  });

  it("returns defaults when config file does not exist", async () => {
    const config = await loadAppConfig("/nonexistent/path/karya.json");
    expect(config.backend?.type).toBe("sqlite");
  });

  it("rejects backend.ssl when backend is sqlite", async () => {
    await expect(setAppConfigValue("backend.ssl", "verify-full")).rejects.toThrow(
      "backend.ssl only applies to pg backend; set backend.connectionString first",
    );
  });

  it("propagates KaryaError from op resolution", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "op://vault/pg/connstring";
    mockState.resolveOpReferenceMock.mockRejectedValueOnce(
      new KaryaError("1Password CLI (op) is not installed or not in PATH.", "CONFIG"),
    );

    await expect(resolveConfig()).rejects.toThrow("1Password CLI (op) is not installed");
  });
});
