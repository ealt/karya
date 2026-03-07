import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAppConfigPath, resolveConfig, setAppConfigValue } from "../../src/core/config.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "KARYA_BACKEND",
  "KARYA_PG_CONNECTION_STRING",
  "KARYA_PG_SSL",
  "KARYA_PG_SSL_CA",
  "KARYA_DB_PATH",
  "KARYA_DATA_DIR",
  "KARYA_FORMAT",
  "KARYA_AUTHOR",
  "KARYA_SKIP_LEGACY_CHECK",
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

describe("resolveConfig pg ssl", () => {
  it("hard-fails on invalid KARYA_PG_SSL values", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "postgresql://localhost/karya";
    process.env.KARYA_PG_SSL = "banana";

    await expect(resolveConfig()).rejects.toThrow("Invalid KARYA_PG_SSL value: banana");
  });

  it("resolves KARYA_PG_SSL and KARYA_PG_SSL_CA env vars", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "postgresql://localhost/karya";
    process.env.KARYA_PG_SSL = "off";
    process.env.KARYA_PG_SSL_CA = "~/certs/ca.pem";

    const config = await resolveConfig();

    expect(config.backend.type).toBe("pg");
    if (config.backend.type !== "pg") {
      throw new Error("expected pg backend");
    }

    expect(config.backend.ssl).toBe("off");
    expect(config.backend.sslCaPath).toBe(join(process.env.HOME as string, "certs", "ca.pem"));
  });
});

describe("setAppConfigValue pg ssl fields", () => {
  it("rejects backend.ssl when backend is sqlite", async () => {
    await expect(setAppConfigValue("backend.ssl", "verify-full")).rejects.toThrow(
      "backend.ssl only applies to pg backend; set backend.connectionString first",
    );
  });

  it("persists backend.ssl and backend.sslCaPath for pg backend", async () => {
    await setAppConfigValue("backend.connectionString", "postgresql://localhost/karya");
    await setAppConfigValue("backend.ssl", "off");
    await setAppConfigValue("backend.sslCaPath", "~/certs/root.pem");

    const config = await resolveConfig();

    expect(config.backend.type).toBe("pg");
    if (config.backend.type !== "pg") {
      throw new Error("expected pg backend");
    }

    expect(config.backend.ssl).toBe("off");
    expect(config.backend.sslCaPath).toBe(join(process.env.HOME as string, "certs", "root.pem"));

    if (process.platform !== "win32") {
      const mode = (await stat(getAppConfigPath())).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});
