import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
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
    "handles setup -> add -> close -> list workflow",
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

      expect((await runCli(["--db-path", dbPath, "edit", taskId, "--close"], homeDir)).code).toBe(0);

      const listOut = await runCli(["--db-path", dbPath, "--format", "json", "list", "--closed"], homeDir);
      expect(listOut.code).toBe(0);
      const listJson = JSON.parse(listOut.stdout) as { data: Array<{ id: string; closedAt: string | null }> };
      expect(listJson.data.map((task) => task.id)).toContain(taskId);

      const showOut = await runCli(["--db-path", dbPath, "--format", "json", "show", taskId.slice(0, 4)], homeDir);
      const showJson = JSON.parse(showOut.stdout) as { data: { task: { id: string; note: string | null } } };
      expect(showJson.data.task.id).toBe(taskId);
      expect(showJson.data.task.note).toBe("initial");
    },
    20000,
  );

  it(
    "supports list --all and rejects edit --status",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "karya-e2e-list-all-"));
      const dbPath = join(root, "karya.db");
      const homeDir = join(root, "home");
      await mkdir(homeDir, { recursive: true });

      const openAdd = await runCli(["--db-path", dbPath, "--format", "json", "add", "Open task"], homeDir);
      const closedAdd = await runCli(["--db-path", dbPath, "--format", "json", "add", "Closed task"], homeDir);
      const openId = (JSON.parse(openAdd.stdout) as { data: { id: string } }).data.id;
      const closedId = (JSON.parse(closedAdd.stdout) as { data: { id: string } }).data.id;

      expect((await runCli(["--db-path", dbPath, "edit", closedId, "--close"], homeDir)).code).toBe(0);

      const allOut = await runCli(["--db-path", dbPath, "--format", "json", "list", "--all"], homeDir);
      expect(allOut.code).toBe(0);
      const allJson = JSON.parse(allOut.stdout) as { data: Array<{ id: string }> };
      expect(allJson.data.map((task) => task.id)).toEqual(expect.arrayContaining([openId, closedId]));

      const statusOut = await runCli(["--db-path", dbPath, "edit", openId, "--status", "done"], homeDir);
      expect(statusOut.code).toBe(1);
      expect(`${statusOut.stdout}\n${statusOut.stderr}`).toContain("unknown option '--status'");
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

  it("allows task creation without setup", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-e2e-no-setup-"));
    const dbPath = join(root, "karya.db");
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });

    const result = await runCli(["--db-path", dbPath, "--format", "json", "add", "Ship MVP"], homeDir);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: { title: string; ownerId: string | null } };
    expect(payload.data.title).toBe("Ship MVP");
    expect(payload.data.ownerId).toBeNull();
  });

  it(
    "exports and imports the v2 task shape",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "karya-e2e-export-import-"));
      const sourceDbPath = join(root, "source.db");
      const targetDbPath = join(root, "target.db");
      const exportDir = join(root, "export");
      const homeDir = join(root, "home");
      await mkdir(homeDir, { recursive: true });

      const addOut = await runCli(["--db-path", sourceDbPath, "--format", "json", "add", "Round trip"], homeDir);
      const taskId = (JSON.parse(addOut.stdout) as { data: { id: string } }).data.id;
      expect((await runCli(["--db-path", sourceDbPath, "edit", taskId, "--close"], homeDir)).code).toBe(0);

      const exportOut = await runCli(["--db-path", sourceDbPath, "export", "--output", exportDir], homeDir);
      expect(exportOut.code).toBe(0);

      const taskFiles = (await readdir(join(exportDir, "tasks"))).filter((name) => name.endsWith(".json"));
      expect(taskFiles).toHaveLength(1);
      const exportedTask = JSON.parse(await readFile(join(exportDir, "tasks", taskFiles[0]), "utf8")) as Record<string, unknown>;
      expect(exportedTask.openedAt).toEqual(expect.any(String));
      expect(exportedTask.closedAt).toEqual(expect.any(String));
      expect("status" in exportedTask).toBe(false);

      const importOut = await runCli(["--db-path", targetDbPath, "import", "--input", exportDir], homeDir);
      expect(importOut.code).toBe(0);

      const listOut = await runCli(["--db-path", targetDbPath, "--format", "json", "list", "--closed"], homeDir);
      expect(listOut.code).toBe(0);
      const listed = JSON.parse(listOut.stdout) as { data: Array<{ id: string; openedAt: string; closedAt: string | null }> };
      expect(listed.data.map((task) => task.id)).toContain(taskId);
      const importedTask = listed.data.find((task) => task.id === taskId);
      expect(importedTask?.openedAt).toEqual(expect.any(String));
      expect(importedTask?.closedAt).toEqual(expect.any(String));
    },
    20000,
  );
});
