import { Command } from "commander";
import { KaryaError } from "../../core/errors.js";
import { startWebServer } from "../../web/server.js";
import type { CliRuntime } from "../shared/runtime.js";

export function registerServeCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("serve")
    .description("Start web UI server")
    .option("--port <port>", "Port")
    .action(async (options: Record<string, string | undefined>, command: Command) => {
      await runtime.runCommand(command, async (context) => {
        const port = Number(options.port ?? context.config.webPort);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new KaryaError(`Invalid port: ${String(options.port)}`, "USAGE");
        }

        await context.store.ensureInitialized();
        await startWebServer({ config: context.config, store: context.store }, port);

        return {
          ok: true,
          message: `Serving on http://localhost:${port}`,
        };
      });
    });
}
