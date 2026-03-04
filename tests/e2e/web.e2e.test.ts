import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initDataRepo, resolveConfig } from "../../src/core/config.js";
import { GitSync } from "../../src/core/git-sync.js";
import { TaskStore } from "../../src/core/task-store.js";
import { createWebApp } from "../../src/web/server.js";

describe("Web e2e", () => {
  it("serves html and supports API task lifecycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "karya-web-e2e-"));
    const homeDir = join(root, "home");
    const dataDir = join(root, "data");
    await mkdir(homeDir, { recursive: true });

    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;
    try {
      await initDataRepo(dataDir, "web-e2e");
      const config = await resolveConfig({ dataDir, noSync: true, format: "json", author: "web-e2e" });
      const store = new TaskStore(dataDir);
      await store.ensureInitialized();
      const sync = new GitSync(dataDir, "web-e2e");

      const app = createWebApp({ config, store, sync });

      const home = await app.request("/");
      expect(home.status).toBe(200);
      expect(await home.text()).toContain("Karya");

      const create = await app.request("/api/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Web task",
          priority: "P1",
          tags: ["web", "api"],
        }),
      });

      expect(create.status).toBe(201);
      const created = (await create.json()) as { task: { id: string; status: string } };
      const id = created.task.id;
      expect(created.task.status).toBe("open");

      const list = await app.request("/api/tasks");
      const listJson = (await list.json()) as { tasks: Array<{ id: string }> };
      expect(listJson.tasks.map((task) => task.id)).toContain(id);

      const done = await app.request(`/api/tasks/${id}/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "done" }),
      });

      const doneJson = (await done.json()) as { task: { status: string } };
      expect(doneJson.task.status).toBe("done");

      const listAfterDone = await app.request("/api/tasks");
      const listAfterDoneJson = (await listAfterDone.json()) as { tasks: Array<{ id: string }> };
      expect(listAfterDoneJson.tasks.map((task) => task.id)).not.toContain(id);

      const archived = await app.request("/api/tasks?includeArchive=true");
      const archivedJson = (await archived.json()) as { tasks: Array<{ id: string; status: string }> };
      expect(archivedJson.tasks.find((task) => task.id === id)?.status).toBe("done");

      const detailHtml = await app.request(`/tasks/${id}`);
      expect(detailHtml.status).toBe(200);
      expect(await detailHtml.text()).toContain("<form");
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
