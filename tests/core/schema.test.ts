import { describe, expect, it } from "vitest";
import { AppConfigSchema, FilterAliasValueSchema, TaskRelationSchema, TaskSchema, UserSchema } from "../../src/core/schema.js";

describe("schema", () => {
  it("applies user defaults", () => {
    const user = UserSchema.parse({
      id: "abcd1234",
      name: "Eric Alt",
      alias: "ealt",
      createdAt: "2026-03-25T00:00:00.000Z",
    });

    expect(user.type).toBe("human");
    expect(user.deactivatedAt).toBeNull();
  });

  it("applies task defaults", () => {
    const task = TaskSchema.parse({
      id: "task1234",
      title: "Test",
      openedAt: "2026-03-25T00:00:00.000Z",
    });

    expect(task.project).toBe("inbox");
    expect(task.priority).toBe("P2");
    expect(task.note).toBeNull();
    expect(task.closedAt).toBeNull();
    expect(task.tags).toEqual([]);
  });

  it("strips legacy lifecycle and audit fields", () => {
    const parsed = TaskSchema.parse({
      id: "task1234",
      title: "Legacy payload",
      openedAt: "2026-03-25T00:00:00.000Z",
      status: "done",
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T01:00:00.000Z",
      createdBy: "user1234",
      updatedBy: "user1234",
    });

    expect("status" in parsed).toBe(false);
    expect("createdAt" in parsed).toBe(false);
    expect("updatedAt" in parsed).toBe(false);
    expect("createdBy" in parsed).toBe(false);
    expect("updatedBy" in parsed).toBe(false);
  });

  it("parses relation schema", () => {
    const relation = TaskRelationSchema.parse({
      sourceId: "task1234",
      targetId: "task5678",
      type: "parent",
    });

    expect(relation.type).toBe("parent");
  });

  it("parses structured filter aliases", () => {
    const alias = FilterAliasValueSchema.parse({
      owner: "me",
      assigneeType: "agent",
    });

    expect(alias.owner).toBe("me");
    expect(alias.assigneeType).toBe("agent");
  });

  it("adds app config defaults for aliases and auto tags", () => {
    const config = AppConfigSchema.parse({
      author: "ealt",
    });

    expect(config.autoTags).toEqual([]);
    expect(config.filterAliases).toEqual({});
  });
});
