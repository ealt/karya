import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { parseBody } from "hono/utils/body";
import type { ResolvedConfig } from "../core/config.js";
import { KaryaError } from "../core/errors.js";
import { GitSync, type SyncWarning } from "../core/git-sync.js";
import type { Priority, Task, TaskStatus } from "../core/schema.js";
import { TaskStore, type EditTaskInput } from "../core/task-store.js";

export interface WebDependencies {
  config: ResolvedConfig;
  store: TaskStore;
  sync: GitSync;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseCsv(input: string | null): string[] | undefined {
  if (!input) {
    return undefined;
  }

  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function statusControls(task: Task): string {
  if (task.status === "done" || task.status === "cancelled") {
    return `<button hx-post="/tasks/${task.id}/status" hx-vals='{"status":"open"}' hx-target="#tasks" hx-swap="outerHTML">Restore</button>`;
  }

  return `
  <button hx-post="/tasks/${task.id}/status" hx-vals='{"status":"in_progress"}' hx-target="#tasks" hx-swap="outerHTML">Start</button>
  <button hx-post="/tasks/${task.id}/status" hx-vals='{"status":"done"}' hx-target="#tasks" hx-swap="outerHTML">Done</button>
  <button hx-post="/tasks/${task.id}/status" hx-vals='{"status":"cancelled"}' hx-target="#tasks" hx-swap="outerHTML">Cancel</button>
  `;
}

function taskCard(task: Task): string {
  const tags = task.tags.length > 0 ? `<small>${task.tags.map((tag) => `#${escapeHtml(tag)}`).join(" ")}</small>` : "";
  const due = task.dueAt ? `<small>Due: ${new Date(task.dueAt).toLocaleString()}</small>` : "";

  return `
<article id="task-${task.id}">
  <header>
    <strong>${escapeHtml(task.title)}</strong>
    <small>${task.id} • ${task.priority} • ${task.status}</small>
  </header>
  <p>${escapeHtml(task.description || "")}</p>
  <p><small>Project: ${escapeHtml(task.project)}</small></p>
  <p>${tags}</p>
  <p>${due}</p>
  <footer>
    ${statusControls(task)}
    <button hx-get="/tasks/${task.id}" hx-target="#task-detail" hx-swap="innerHTML">Details</button>
  </footer>
</article>`;
}

function taskList(tasks: Task[]): string {
  if (tasks.length === 0) {
    return `<section id="tasks"><p>No tasks</p></section>`;
  }

  return `<section id="tasks">${tasks.map(taskCard).join("\n")}</section>`;
}

function taskDetail(task: Task): string {
  return `
<article>
  <header>
    <h3>${escapeHtml(task.title)}</h3>
    <small>${task.id}</small>
  </header>
  <form hx-post="/tasks/${task.id}/edit" hx-target="#task-detail" hx-swap="innerHTML">
    <label>Title<input name="title" value="${escapeHtml(task.title)}" required /></label>
    <label>Description<textarea name="description">${escapeHtml(task.description)}</textarea></label>
    <label>Project<input name="project" value="${escapeHtml(task.project)}" /></label>
    <label>Priority
      <select name="priority">
        <option value="P0" ${task.priority === "P0" ? "selected" : ""}>P0</option>
        <option value="P1" ${task.priority === "P1" ? "selected" : ""}>P1</option>
        <option value="P2" ${task.priority === "P2" ? "selected" : ""}>P2</option>
        <option value="P3" ${task.priority === "P3" ? "selected" : ""}>P3</option>
      </select>
    </label>
    <label>Tags (comma-separated)<input name="tags" value="${escapeHtml(task.tags.join(","))}" /></label>
    <label>Due<input name="due" value="${escapeHtml(task.dueAt ?? "")}" placeholder="tomorrow or 2026-03-10" /></label>
    <label>Note<textarea name="note" placeholder="Append note"></textarea></label>
    <button type="submit">Save</button>
  </form>
  <details>
    <summary>Notes (${task.notes.length})</summary>
    <ul>
      ${task.notes
        .map(
          (note) =>
            `<li><strong>${escapeHtml(note.author)}</strong> <small>${escapeHtml(note.timestamp)}</small><br/>${escapeHtml(
              note.body,
            )}</li>`,
        )
        .join("\n") || "<li>No notes</li>"}
    </ul>
  </details>
</article>`;
}

function warningsBlock(warnings: SyncWarning[]): string {
  if (warnings.length === 0) {
    return "";
  }

  return `<aside>${warnings
    .map((warning) => `<p>warning [${warning.code}]: ${escapeHtml(warning.message)}</p>`)
    .join("")}</aside>`;
}

function page(tasks: Task[], warnings: SyncWarning[] = []): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Karya</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body>
  <main class="container">
    <h1>Karya</h1>
    <form hx-post="/tasks" hx-target="#tasks" hx-swap="outerHTML">
      <label>Title <input name="title" required /></label>
      <label>Description <input name="description" /></label>
      <label>Project <input name="project" value="inbox" /></label>
      <label>Priority
        <select name="priority">
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2" selected>P2</option>
          <option value="P3">P3</option>
        </select>
      </label>
      <label>Tags (comma-separated) <input name="tags" /></label>
      <label>Due <input name="due" placeholder="tomorrow" /></label>
      <button type="submit">Add Task</button>
    </form>

    <form hx-get="/tasks" hx-target="#tasks" hx-swap="outerHTML">
      <label>Project <input name="project" placeholder="foo,bar" /></label>
      <label>Priority <input name="priority" placeholder="P0,P1" /></label>
      <label>Status <input name="status" placeholder="open,in_progress" /></label>
      <label>Tags <input name="tag" placeholder="agent,backend" /></label>
      <label><input type="checkbox" name="archive" value="1" /> Include archive</label>
      <button type="submit">Filter</button>
    </form>

    ${warningsBlock(warnings)}

    <div class="grid">
      ${taskList(tasks)}
      <section id="task-detail"><p>Select a task to view details.</p></section>
    </div>
  </main>
</body>
</html>`;
}

function parseStatus(value: unknown): TaskStatus | "open" {
  if (value === "open" || value === "in_progress" || value === "done" || value === "cancelled") {
    return value;
  }
  throw new KaryaError(`Unsupported status transition: ${String(value)}`, "VALIDATION");
}

async function runWrite<T>(
  deps: WebDependencies,
  operation: () => Promise<T>,
  commitMessage: string,
): Promise<{ result: T; warnings: SyncWarning[] }> {
  if (deps.config.noSync || !deps.config.autoSync) {
    return {
      result: await operation(),
      warnings: [],
    };
  }

  const write = await deps.sync.runWriteCycle(operation, commitMessage, deps.config.syncRetries);
  return {
    result: write.result,
    warnings: write.sync.warnings,
  };
}

async function listTasksFromQuery(store: TaskStore, url: URL): Promise<Task[]> {
  return store.listTasks({
    includeArchive: url.searchParams.get("archive") === "1" || url.searchParams.get("includeArchive") === "true",
    project: parseCsv(url.searchParams.get("project")),
    priority: parseCsv(url.searchParams.get("priority")) as Priority[] | undefined,
    status: parseCsv(url.searchParams.get("status")) as TaskStatus[] | undefined,
    tag: parseCsv(url.searchParams.get("tag")),
  });
}

function formBodyToEdit(body: Record<string, string | File>, includeDue = true): EditTaskInput {
  const tagsRaw = typeof body.tags === "string" ? body.tags : "";

  return {
    title: typeof body.title === "string" ? body.title : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    project: typeof body.project === "string" ? body.project : undefined,
    priority: typeof body.priority === "string" ? (body.priority as Priority) : undefined,
    tags: tagsRaw.length > 0 ? tagsRaw.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
    due: includeDue
      ? typeof body.due === "string"
        ? body.due.trim().length > 0
          ? body.due
          : null
        : undefined
      : undefined,
    note: typeof body.note === "string" && body.note.trim().length > 0 ? body.note : undefined,
  };
}

export function createWebApp(deps: WebDependencies): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tasks = await deps.store.listTasks();
    return c.html(page(tasks));
  });

  app.get("/tasks", async (c) => {
    const tasks = await listTasksFromQuery(deps.store, new URL(c.req.url));
    return c.html(taskList(tasks));
  });

  app.get("/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const ref = await deps.store.showTask(id, true);
    return c.html(taskDetail(ref.task));
  });

  app.post("/tasks", async (c) => {
    const body = await parseBody(c.req.raw);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.text("title is required", 400);
    }

    await runWrite(
      deps,
      async () =>
        deps.store.addTask(
          {
            title,
            description: typeof body.description === "string" ? body.description : undefined,
            project: typeof body.project === "string" ? body.project : undefined,
            priority: typeof body.priority === "string" ? (body.priority as Priority) : undefined,
            tags:
              typeof body.tags === "string"
                ? body.tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                : undefined,
            due: typeof body.due === "string" ? body.due : undefined,
          },
          deps.config.author,
          {
            project: deps.config.defaultProject,
            priority: deps.config.defaultPriority,
          },
        ),
      "karya(web): add task",
    );

    const tasks = await deps.store.listTasks();
    return c.html(taskList(tasks));
  });

  app.post("/tasks/:id/status", async (c) => {
    const id = c.req.param("id");
    const body = await parseBody(c.req.raw);
    const status = parseStatus(typeof body.status === "string" ? body.status : "");

    await runWrite(
      deps,
      async () => {
        if (status === "in_progress") {
          return deps.store.startTask(id, deps.config.author);
        }
        if (status === "done") {
          return deps.store.doneTask(id, deps.config.author);
        }
        if (status === "cancelled") {
          return deps.store.cancelTask(id, deps.config.author);
        }
        return deps.store.restoreTask(id, deps.config.author);
      },
      `karya(web): status ${status} ${id}`,
    );

    const tasks = await deps.store.listTasks();
    return c.html(taskList(tasks));
  });

  app.post("/tasks/:id/edit", async (c) => {
    const id = c.req.param("id");
    const body = await parseBody(c.req.raw);

    const write = await runWrite(
      deps,
      async () => deps.store.editTask(id, formBodyToEdit(body), deps.config.author),
      `karya(web): edit ${id}`,
    );

    return c.html(`${warningsBlock(write.warnings)}${taskDetail(write.result)}`);
  });

  app.get("/api/tasks", async (c) => {
    const tasks = await listTasksFromQuery(deps.store, new URL(c.req.url));
    return c.json({ tasks });
  });

  app.get("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const ref = await deps.store.showTask(id, true);
    return c.json({ task: ref.task, bucket: ref.bucket });
  });

  app.post("/api/tasks", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const write = await runWrite(
      deps,
      async () =>
        deps.store.addTask(
          {
            title: String(body.title ?? "").trim(),
            description: typeof body.description === "string" ? body.description : undefined,
            project: typeof body.project === "string" ? body.project : undefined,
            priority: typeof body.priority === "string" ? (body.priority as Priority) : undefined,
            tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
            due: typeof body.due === "string" ? body.due : undefined,
            parentId: typeof body.parentId === "string" ? body.parentId : null,
            note: typeof body.note === "string" ? body.note : undefined,
          },
          deps.config.author,
          {
            project: deps.config.defaultProject,
            priority: deps.config.defaultPriority,
          },
        ),
      "karya(api): add task",
    );

    return c.json({ task: write.result, warnings: write.warnings }, 201);
  });

  app.patch("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Record<string, unknown>>();

    const write = await runWrite(
      deps,
      async () =>
        deps.store.editTask(
          id,
          {
            title: typeof body.title === "string" ? body.title : undefined,
            description: typeof body.description === "string" ? body.description : undefined,
            project: typeof body.project === "string" ? body.project : undefined,
            priority: typeof body.priority === "string" ? (body.priority as Priority) : undefined,
            tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
            due: typeof body.due === "string" ? body.due : body.due === null ? null : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
          },
          deps.config.author,
        ),
      `karya(api): edit ${id}`,
    );

    return c.json({ task: write.result, warnings: write.warnings });
  });

  app.post("/api/tasks/:id/status", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Record<string, unknown>>();
    const status = parseStatus(body.status);

    const write = await runWrite(
      deps,
      async () => {
        if (status === "in_progress") {
          return deps.store.startTask(id, deps.config.author);
        }
        if (status === "done") {
          return deps.store.doneTask(id, deps.config.author);
        }
        if (status === "cancelled") {
          return deps.store.cancelTask(id, deps.config.author);
        }
        return deps.store.restoreTask(id, deps.config.author);
      },
      `karya(api): status ${status} ${id}`,
    );

    return c.json({ task: write.result, warnings: write.warnings });
  });

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof KaryaError && ["NOT_FOUND", "INVALID_ID"].includes(error.code) ? 404 : 400;

    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: message }, status);
    }

    return c.html(`<p>${escapeHtml(message)}</p>`, status);
  });

  return app;
}

export async function startWebServer(deps: WebDependencies, port: number): Promise<void> {
  const app = createWebApp(deps);

  serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      process.stdout.write(`Karya web UI running on http://localhost:${port}\n`);
    },
  );
}
