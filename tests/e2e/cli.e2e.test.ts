import { execFile } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runCli(args: string[], homeDir: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", ["--import", "tsx", "src/cli/index.ts", ...args], {
      cwd: projectRoot,
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
  it("prints the CLI version", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-e2e-version-"));
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });

    const result = await runCli(["--version"], homeDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(version);
  });

  it(
    "handles setup -> add -> edit status -> list workflow",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "karya-e2e-"));
      const dbPath = join(root, "karya.db");
      const homeDir = join(root, "home");
      await mkdir(homeDir, { recursive: true });

      expect(
        (
          await runCli(
            ["--db-path", dbPath, "--format", "json", "setup", "--alias", "ealt", "--name", "Eric Alt"],
            homeDir,
          )
        ).code,
      ).toBe(0);

      const addOut = await runCli(["--db-path", dbPath, "--format", "json", "add", "Ship MVP", "--note", "initial"], homeDir);
      expect(addOut.code).toBe(0);
      const addJson = JSON.parse(addOut.stdout) as { data: { id: string } };
      const taskId = addJson.data.id;

      expect((await runCli(["--db-path", dbPath, "edit", taskId, "--status", "done"], homeDir)).code).toBe(0);

      const listOut = await runCli(["--db-path", dbPath, "--format", "json", "list", "--status", "done"], homeDir);
      expect(listOut.code).toBe(0);
      const listJson = JSON.parse(listOut.stdout) as { data: Array<{ id: string; status: string }> };
      expect(listJson.data.map((task) => task.id)).toContain(taskId);

      const showOut = await runCli(["--db-path", dbPath, "--format", "json", "show", taskId.slice(0, 4)], homeDir);
      const showJson = JSON.parse(showOut.stdout) as { data: { task: { id: string; note: string | null } } };
      expect(showJson.data.task.id).toBe(taskId);
      expect(showJson.data.task.note).toBe("initial");
    },
    20000,
  );

  it("rejects old archive and transition commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-e2e-unknown-"));
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });

    for (const command of [["archive"], ["start", "abcd1234"], ["done", "abcd1234"], ["cancel", "abcd1234"]]) {
      const result = await runCli(command, homeDir);
      expect(result.code).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`.toLowerCase()).toContain("unknown command");
    }
  });

  it(
    "supports user CRUD via CLI",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "karya-e2e-users-"));
      const dbPath = join(root, "karya.db");
      const homeDir = join(root, "home");
      await mkdir(homeDir, { recursive: true });

      await runCli(["--db-path", dbPath, "config", "init"], homeDir);
      await runCli(["--db-path", dbPath, "users", "add", "--name", "Eric Alt", "--alias", "ealt"], homeDir);
      await runCli(["--db-path", dbPath, "config", "set", "author", "ealt"], homeDir);
      const addAgent = await runCli(
        ["--db-path", dbPath, "users", "add", "--name", "fraxl", "--alias", "fraxl", "--type", "agent"],
        homeDir,
      );
      expect(addAgent.code).toBe(0);

      const listUsers = await runCli(["--db-path", dbPath, "--format", "json", "users", "list"], homeDir);
      const usersJson = JSON.parse(listUsers.stdout) as { data: Array<{ alias: string }> };
      expect(usersJson.data.map((user) => user.alias)).toEqual(expect.arrayContaining(["ealt", "fraxl"]));

      const deactivate = await runCli(["--db-path", dbPath, "users", "remove", "fraxl"], homeDir);
      expect(deactivate.code).toBe(0);
    },
    20000,
  );

  it("fails mutating commands without setup", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-e2e-nosetup-"));
    const dbPath = join(root, "karya.db");
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });

    const result = await runCli(["--db-path", dbPath, "add", "Ship MVP"], homeDir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("No user configured. Run `karya setup` first.");
  });
});
