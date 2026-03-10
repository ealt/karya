import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const poolConfigs: unknown[] = [];
  const queryMock = vi.fn(async () => ({ rows: [] }));
  const endMock = vi.fn(async () => undefined);
  const readFileMock = vi.fn(async () => "CA_CERT");

  class MockPool {
    constructor(config: unknown) {
      poolConfigs.push(config);
    }

    query = queryMock;
    end = endMock;
  }

  return {
    poolConfigs,
    queryMock,
    endMock,
    readFileMock,
    MockPool,
  };
});

vi.mock("pg", () => ({
  Pool: mockState.MockPool,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockState.readFileMock,
}));

import { createPool } from "../../../src/core/backends/pg.js";
import { KaryaError } from "../../../src/core/errors.js";

describe("createPool", () => {
  beforeEach(() => {
    mockState.poolConfigs.length = 0;
    mockState.queryMock.mockReset();
    mockState.queryMock.mockResolvedValue({ rows: [] });
    mockState.endMock.mockReset();
    mockState.endMock.mockResolvedValue(undefined);
    mockState.readFileMock.mockReset();
    mockState.readFileMock.mockResolvedValue("CA_CERT");
  });

  it("uses verify-full TLS config by default", async () => {
    await createPool("postgresql://localhost/karya", { mode: "verify-full" });

    const config = mockState.poolConfigs[0] as {
      ssl: { rejectUnauthorized: boolean; ca?: string };
      max: number;
      idleTimeoutMillis: number;
      connectionTimeoutMillis: number;
    };

    expect(config.ssl.rejectUnauthorized).toBe(true);
    expect(config.ssl.ca).toBeUndefined();
    expect(config.max).toBe(5);
    expect(config.idleTimeoutMillis).toBe(10_000);
    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(mockState.queryMock).toHaveBeenCalledWith("SELECT 1");
  });

  it("loads CA when provided", async () => {
    mockState.readFileMock.mockResolvedValueOnce("MY_CA");

    await createPool("postgresql://localhost/karya", {
      mode: "verify-full",
      caPath: "/tmp/ca.pem",
    });

    const config = mockState.poolConfigs[0] as {
      ssl: { rejectUnauthorized: boolean; ca?: string };
    };

    expect(mockState.readFileMock).toHaveBeenCalledWith("/tmp/ca.pem", "utf8");
    expect(config.ssl.rejectUnauthorized).toBe(true);
    expect(config.ssl.ca).toBe("MY_CA");
  });

  it("disables TLS in off mode", async () => {
    await createPool("postgresql://localhost/karya", { mode: "off" });

    const config = mockState.poolConfigs[0] as { ssl: false };
    expect(config.ssl).toBe(false);
    expect(mockState.readFileMock).not.toHaveBeenCalled();
  });

  it("redacts connection strings in connection errors", async () => {
    mockState.queryMock.mockRejectedValueOnce(
      new Error("dial failed postgresql://user:secret@example.com:5432/karya"),
    );

    const error = await createPool("postgresql://user:secret@example.com:5432/karya", { mode: "off" }).catch((err) => err);

    expect(error).toBeInstanceOf(KaryaError);
    expect((error as KaryaError).message).toContain("postgresql://***");
    expect((error as KaryaError).message).not.toContain("secret@example.com");
    expect(mockState.endMock).toHaveBeenCalledTimes(1);
  });

  it("redacts split pg fields in connection errors", async () => {
    mockState.queryMock.mockRejectedValueOnce(
      new Error(
        'connect failed host=db.example.com user=alice password=s3cr3t dbname=karya payload={"host":"db.example.com","user":"alice","password":"s3cr3t","database":"karya"}',
      ),
    );

    const error = await createPool("postgresql://localhost/karya", { mode: "off" }).catch((err) => err);

    expect(error).toBeInstanceOf(KaryaError);
    const message = (error as KaryaError).message;
    expect(message).toContain("host=***");
    expect(message).toContain("user=***");
    expect(message).toContain("password=***");
    expect(message).toContain("dbname=***");
    expect(message).toContain('"host":"***"');
    expect(message).toContain('"user":"***"');
    expect(message).toContain('"password":"***"');
    expect(message).toContain('"database":"***"');
    expect(message).not.toContain("db.example.com");
    expect(message).not.toContain("alice");
    expect(message).not.toContain("s3cr3t");
    expect(mockState.endMock).toHaveBeenCalledTimes(1);
  });
});
