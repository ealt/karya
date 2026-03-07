import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerCommands } from "../../../src/cli/commands/index.js";
import type { CliRuntime } from "../../../src/cli/shared/runtime.js";

describe("registerCommands", () => {
  it("does not register serve command", () => {
    const program = new Command();
    registerCommands(program, {} as CliRuntime);

    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).not.toContain("serve");
  });
});
