import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const execFileAsync = vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>();
  return { execFileAsync };
});

vi.mock("node:child_process", () => {
  // The real execFile has [util.promisify.custom] so that promisify returns
  // { stdout, stderr } instead of a single value.  We replicate that here.
  const fn = Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: mockState.execFileAsync,
  });
  return { execFile: fn };
});

import { isOpReference, resolveOpReference } from "../../src/core/op-resolve.js";

describe("isOpReference", () => {
  it("returns true for op:// prefixed strings", () => {
    expect(isOpReference("op://vault/item/field")).toBe(true);
    expect(isOpReference("op://work/database/url")).toBe(true);
  });

  it("returns false for postgres connection strings", () => {
    expect(isOpReference("postgresql://localhost/karya")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(isOpReference("")).toBe(false);
  });
});

describe("resolveOpReference", () => {
  beforeEach(() => {
    mockState.execFileAsync.mockReset();
  });

  it("resolves a valid 1Password reference", async () => {
    mockState.execFileAsync.mockResolvedValueOnce({ stdout: "postgresql://user:pass@host/db\n", stderr: "" });

    const result = await resolveOpReference("op://vault/item/field");

    expect(result).toBe("postgresql://user:pass@host/db");
    expect(mockState.execFileAsync).toHaveBeenCalledWith("op", ["read", "op://vault/item/field"], expect.objectContaining({ timeout: 30_000 }));
  });

  it("throws CONFIG error when op is not installed", async () => {
    const err = new Error("spawn op ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockState.execFileAsync.mockRejectedValueOnce(err);

    await expect(resolveOpReference("op://vault/item/field")).rejects.toThrow(
      "1Password CLI (op) is not installed",
    );
  });

  it("throws CONFIG error with stderr on auth failure", async () => {
    mockState.execFileAsync.mockRejectedValueOnce(
      Object.assign(new Error("exit code 1"), { stderr: "[ERROR] not signed in" }),
    );

    await expect(resolveOpReference("op://vault/item/field")).rejects.toThrow("not signed in");
  });

  it("throws CONFIG error when resolved value is empty", async () => {
    mockState.execFileAsync.mockResolvedValueOnce({ stdout: "\n", stderr: "" });

    await expect(resolveOpReference("op://vault/item/field")).rejects.toThrow(
      "resolved to an empty value",
    );
  });
});
