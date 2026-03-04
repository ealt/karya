import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function runCli(args: string[], homeDir: string): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    "node",
    ["--import", "tsx", "src/cli/index.ts", ...args],
    {
      cwd: "/init-sandbox",
      env: {
        ...process.env,
        HOME: homeDir,
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return { stdout, stderr };
}

describe("CLI e2e", () => {
  it(
    "handles init -> add -> done -> archive restore workflow",
    async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-e2e-"));
    const dataDir = join(root, "data");
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });

    await runCli(["--data-dir", dataDir, "--no-sync", "config", "init"], homeDir);

    const addOut = await runCli([
      "--data-dir",
      dataDir,
      "--no-sync",
      "--format",
      "json",
      "add",
      "Ship MVP",
      "-P",
      "P1",
      "--due",
      "tomorrow",
      "--note",
      "initial context",
    ], homeDir);

    const addJson = JSON.parse(addOut.stdout) as { data: { id: string } };
    const taskId = addJson.data.id;
    expect(taskId).toHaveLength(8);

    const listOut = await runCli(["--data-dir", dataDir, "--no-sync", "--format", "json", "list"], homeDir);
    const listJson = JSON.parse(listOut.stdout) as { data: Array<{ id: string }> };
    expect(listJson.data.map((task) => task.id)).toContain(taskId);

    await runCli(["--data-dir", dataDir, "--no-sync", "done", taskId], homeDir);

    const activeOut = await runCli(
      ["--data-dir", dataDir, "--no-sync", "--format", "json", "list", "--status", "open,in_progress"],
      homeDir,
    );
    const activeJson = JSON.parse(activeOut.stdout) as { data: Array<{ id: string }> };
    expect(activeJson.data.map((task) => task.id)).not.toContain(taskId);

    const archiveOut = await runCli(
      ["--data-dir", dataDir, "--no-sync", "--format", "json", "archive", "list"],
      homeDir,
    );
    const archiveJson = JSON.parse(archiveOut.stdout) as { data: Array<{ id: string }> };
    expect(archiveJson.data.map((task) => task.id)).toContain(taskId);

    await runCli(["--data-dir", dataDir, "--no-sync", "archive", "restore", taskId], homeDir);

    const showByPrefix = await runCli(
      ["--data-dir", dataDir, "--no-sync", "--format", "json", "show", taskId.slice(0, 4)],
      homeDir,
    );
    const showJson = JSON.parse(showByPrefix.stdout) as { data: { id: string; status: string } };
    expect(showJson.data.id).toBe(taskId);
    expect(showJson.data.status).toBe("open");
    },
    20000,
  );
});
