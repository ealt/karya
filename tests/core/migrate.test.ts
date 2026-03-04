import { describe, expect, it } from "vitest";
import { migrateTaskRecord } from "../../src/core/migrate.js";

describe("migrations", () => {
  it("migrates legacy task without schemaVersion", () => {
    const task = migrateTaskRecord({
      id: "abcd1234",
      title: "Legacy",
      createdAt: "2026-03-04T00:00:00.000Z",
      updatedAt: "2026-03-04T00:00:00.000Z",
      createdBy: "legacy",
      updatedBy: "legacy",
    });

    expect(task.schemaVersion).toBe(1);
    expect(task.status).toBe("open");
    expect(Array.isArray(task.conflicts)).toBe(true);
  });
});
