import { describe, expect, it } from "vitest";
import { TaskSchema } from "../../src/core/schema.js";

describe("TaskSchema", () => {
  it("applies defaults", () => {
    const task = TaskSchema.parse({
      id: "abcd1234",
      title: "Test",
      createdAt: "2026-03-04T00:00:00.000Z",
      updatedAt: "2026-03-04T00:00:00.000Z",
      createdBy: "cli",
      updatedBy: "cli",
    });

    expect(task.schemaVersion).toBe(1);
    expect(task.priority).toBe("P2");
    expect(task.status).toBe("open");
    expect(task.project).toBe("inbox");
    expect(task.notes).toEqual([]);
  });
});
