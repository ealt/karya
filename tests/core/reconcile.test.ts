import { describe, expect, it } from "vitest";
import { reconcileTasks } from "../../src/core/reconcile.js";
import { makeTask } from "../helpers/factories.js";

describe("reconcileTasks", () => {
  it("uses last-writer-wins for scalars and unions tags", () => {
    const local = makeTask({
      id: "task0001",
      title: "Local",
      note: "local",
      tags: ["cli", "urgent"],
      updatedAt: "2026-03-25T11:00:00.000Z",
    });
    const remote = makeTask({
      id: "task0001",
      title: "Remote",
      note: "remote",
      tags: ["backend", "cli"],
      updatedAt: "2026-03-25T10:00:00.000Z",
    });

    const merged = reconcileTasks(local, remote);

    expect(merged.title).toBe("Local");
    expect(merged.note).toBe("local");
    expect(merged.tags).toEqual(["backend", "cli", "urgent"]);
  });
});
