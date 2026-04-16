import { describe, expect, it } from "vitest";
import { formatTaskDetail, formatTaskLine } from "../../../src/cli/formatters/output.js";

describe("formatTaskLine", () => {
  const task = {
    id: "task1234",
    priority: "P2",
    project: "inbox",
    title: "Fix the bug",
    ownerId: "user1234",
    assigneeId: "user5678",
    closedAt: null,
  };

  it("shows raw IDs when no resolver is provided", () => {
    const line = formatTaskLine(task);
    expect(line).toContain("owner=user1234");
    expect(line).toContain("assignee=user5678");
  });

  it("resolves IDs to aliases when resolver is provided", () => {
    const aliases = new Map([
      ["user1234", "eric"],
      ["user5678", "planner"],
    ]);
    const line = formatTaskLine(task, (id) => aliases.get(id) ?? id);
    expect(line).toContain("owner=eric");
    expect(line).toContain("assignee=planner");
  });

  it("falls back to raw ID for unknown users", () => {
    const line = formatTaskLine(task, (id) => new Map<string, string>().get(id) ?? id);
    expect(line).toContain("owner=user1234");
  });
});

describe("formatTaskDetail", () => {
  const detail = {
    task: {
      id: "task1234",
      title: "Fix the bug",
      priority: "P2",
      project: "inbox",
      openedAt: "2026-03-25T00:00:00.000Z",
      closedAt: null,
      ownerId: "user1234",
      assigneeId: "user5678",
      tags: ["cli"],
      note: null,
    },
    relations: [],
  };

  it("resolves IDs to aliases when resolver is provided", () => {
    const aliases = new Map([
      ["user1234", "eric"],
      ["user5678", "planner"],
    ]);
    const output = formatTaskDetail(detail, (id) => aliases.get(id) ?? id);
    expect(output).toContain("owner: eric");
    expect(output).toContain("assignee: planner");
  });

  it("shows raw IDs when no resolver is provided", () => {
    const output = formatTaskDetail(detail);
    expect(output).toContain("owner: user1234");
    expect(output).toContain("assignee: user5678");
  });
});
