import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runCli(args: string[], homeDir: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", ["--import", "tsx", "src/cli/index.ts", ...args], {
      cwd: "/karya-sandbox",
      env: {
        ...process.env,
        HOME: homeDir,
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    return { stdout, stderr, code: 0 };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };

    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

describe("CLI e2e", () => {
  it(
    "handles init -> add -> done -> archive restore workflow",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "karya-e2e-"));
      const dbPath = join(root, "karya.db");
      const homeDir = join(root, "home");
      await mkdir(homeDir, { recursive: true });

      expect((await runCli(["--db-path", dbPath, "config", "init"], homeDir)).code).toBe(0);

      const addOut = await runCli(
        [
          "--db-path",
          dbPath,
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
        ],
        homeDir,
      );

      expect(addOut.code).toBe(0);
      const addJson = JSON.parse(addOut.stdout) as { data: { id: string } };
      const taskId = addJson.data.id;
      expect(taskId).toHaveLength(8);

      const listOut = await runCli(["--db-path", dbPath, "--format", "json", "list"], homeDir);
      expect(listOut.code).toBe(0);
      const listJson = JSON.parse(listOut.stdout) as { data: Array<{ id: string }> };
      expect(listJson.data.map((task) => task.id)).toContain(taskId);

      expect((await runCli(["--db-path", dbPath, "done", taskId], homeDir)).code).toBe(0);

      const activeOut = await runCli(["--db-path", dbPath, "--format", "json", "list", "--status", "open,in_progress"], homeDir);
      const activeJson = JSON.parse(activeOut.stdout) as { data: Array<{ id: string }> };
      expect(activeJson.data.map((task) => task.id)).not.toContain(taskId);

      const archiveOut = await runCli(["--db-path", dbPath, "--format", "json", "archive", "list"], homeDir);
      const archiveJson = JSON.parse(archiveOut.stdout) as { data: Array<{ id: string }> };
      expect(archiveJson.data.map((task) => task.id)).toContain(taskId);

      expect((await runCli(["--db-path", dbPath, "archive", "restore", taskId], homeDir)).code).toBe(0);

      const showByPrefix = await runCli(["--db-path", dbPath, "--format", "json", "show", taskId.slice(0, 4)], homeDir);
      const showJson = JSON.parse(showByPrefix.stdout) as { data: { id: string; status: string } };
      expect(showJson.data.id).toBe(taskId);
      expect(showJson.data.status).toBe("open");
    },
    20000,
  );

  it("blocks on legacy task directories unless explicitly skipped", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-e2e-legacy-"));
    const homeDir = join(root, "home");
    const dbPath = join(root, "karya.db");
    const tasksDir = join(root, "tasks");

    await mkdir(homeDir, { recursive: true });
    await mkdir(tasksDir, { recursive: true });
    await writeFile(join(tasksDir, "abcd1234.json"), "{}\n", "utf8");

    const blocked = await runCli(["--db-path", dbPath, "list"], homeDir);
    expect(blocked.code).toBe(1);
    expect(blocked.stdout).toContain("Legacy JSON task data detected");

    const bypassed = await runCli(["--db-path", dbPath, "--skip-legacy-check", "list"], homeDir);
    expect(bypassed.code).toBe(0);
  });
});
