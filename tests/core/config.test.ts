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

describe("loadAppConfig legacy keys", () => {
  it("loads legacy config containing web without falling back to defaults", async () => {
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
          author: "legacy-author",
          defaultProject: "legacy-project",
          defaultPriority: "P1",
          web: { port: 9999 },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = await loadAppConfig(configPath);
    expect(config.author).toBe("legacy-author");
    expect(config.defaultProject).toBe("legacy-project");
    expect(config.defaultPriority).toBe("P1");
    expect(config.backend?.type).toBe("pg");
    if (config.backend?.type !== "pg") {
      throw new Error("expected pg backend");
    }
    expect(config.backend.connectionString).toBe("postgresql://localhost/custom");
    expect(config.backend.ssl).toBe("off");
  });
});

describe("resolveConfig op:// connection string", () => {
  beforeEach(() => {
    mockState.resolveOpReferenceMock.mockReset();
  });

  it("resolves op:// connection string from env var", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "op://vault/pg/connstring";
    mockState.resolveOpReferenceMock.mockResolvedValueOnce("postgresql://resolved@host/db");

    const config = await resolveConfig();

    expect(config.backend.type).toBe("pg");
    if (config.backend.type !== "pg") throw new Error("expected pg");
    expect(config.backend.connectionString).toBe("postgresql://resolved@host/db");
    expect(mockState.resolveOpReferenceMock).toHaveBeenCalledWith("op://vault/pg/connstring");
  });

  it("does not call resolveOpReference for regular connection strings", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "postgresql://localhost/karya";

    const config = await resolveConfig();

    expect(config.backend.type).toBe("pg");
    if (config.backend.type !== "pg") throw new Error("expected pg");
    expect(config.backend.connectionString).toBe("postgresql://localhost/karya");
    expect(mockState.resolveOpReferenceMock).not.toHaveBeenCalled();
  });

  it("propagates KaryaError from op resolution", async () => {
    process.env.KARYA_BACKEND = "pg";
    process.env.KARYA_PG_CONNECTION_STRING = "op://vault/pg/connstring";
    mockState.resolveOpReferenceMock.mockRejectedValueOnce(
      new KaryaError("1Password CLI (op) is not installed or not in PATH.", "CONFIG"),
    );

    await expect(resolveConfig()).rejects.toThrow("1Password CLI (op) is not installed");
  });

  it("resolves op:// connection string from app config", async () => {
    const configPath = getAppConfigPath();
    await mkdir(join(process.env.HOME as string, ".config", "karya"), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        backend: {
          type: "pg",
          connectionString: "op://work/database/url",
          ssl: "off",
        },
      }),
      "utf8",
    );
    mockState.resolveOpReferenceMock.mockResolvedValueOnce("postgresql://fromconfig@host/db");

    const config = await resolveConfig();

    expect(config.backend.type).toBe("pg");
    if (config.backend.type !== "pg") throw new Error("expected pg");
    expect(config.backend.connectionString).toBe("postgresql://fromconfig@host/db");
    expect(mockState.resolveOpReferenceMock).toHaveBeenCalledWith("op://work/database/url");
  });
});
