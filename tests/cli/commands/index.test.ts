import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerCommands } from "../../../src/cli/commands/index.js";
import type { CliRuntime } from "../../../src/cli/shared/runtime.js";

describe("registerCommands", () => {
  it("registers setup/users and not archive/transition commands", () => {
    const program = new Command();
    registerCommands(program, {} as CliRuntime);

    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain("setup");
    expect(commandNames).toContain("users");
    expect(commandNames).not.toContain("archive");
    expect(commandNames).not.toContain("start");
    expect(commandNames).not.toContain("done");
    expect(commandNames).not.toContain("cancel");
  });
});
