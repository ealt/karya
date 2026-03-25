import { describe, expect, it } from "vitest";
import { expandFilterAlias } from "../../../src/cli/shared/aliases.js";

describe("expandFilterAlias", () => {
  it("expands structured aliases and resolves 'me'", () => {
    const expanded = expandFilterAlias(
      {
        owner: "me",
        assignee: "none",
        assigneeType: "agent",
        project: "karya",
      },
      "ealt",
    );

    expect(expanded.owner).toBe("ealt");
    expect(expanded.assignee).toBe("none");
    expect(expanded.assigneeType).toBe("agent");
    expect(expanded.project).toEqual(["karya"]);
  });
});
