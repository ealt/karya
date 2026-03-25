import { describe, expect, it } from "vitest";
import { filterTasks } from "../../src/core/query.js";
import { makeTask, makeUser } from "../helpers/factories.js";

describe("filterTasks", () => {
  it("filters by owner, assignee, and assignee type", () => {
    const agent = makeUser({ id: "agent001", alias: "agent", type: "agent" });
    const human = makeUser({ id: "human001", alias: "human", type: "human" });
    const tasks = [
      makeTask({ id: "task0001", ownerId: human.id, assigneeId: agent.id, tags: ["cli"] }),
      makeTask({ id: "task0002", ownerId: agent.id, assigneeId: human.id }),
    ];
    const users = new Map([
      [agent.id, agent],
      [human.id, human],
    ]);

    const filtered = filterTasks(
      tasks,
      {
        ownerId: human.id,
        assigneeType: "agent",
      },
      (id) => users.get(id) ?? null,
    );

    expect(filtered.map((task) => task.id)).toEqual(["task0001"]);
  });
});
