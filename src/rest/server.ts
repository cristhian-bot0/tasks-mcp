import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { openDb } from "../core/db.js";
import {
  createTask,
  updateTask,
  getTask,
  listTasks,
  setStatus,
  setPlan,
  addNote,
  deleteTask,
  searchTasks,
} from "../core/tasks.js";
import { getContext } from "../core/context.js";
import {
  createProject,
  listProjects,
  archiveProject,
} from "../core/projects.js";
import {
  createLabel,
  listLabels,
  tagTask,
  untagTask,
} from "../core/labels.js";
import {
  addSubtask,
  listSubtasks,
  setSubtaskDone,
  deleteSubtask,
} from "../core/subtasks.js";
import {
  addDependency,
  removeDependency,
  listDependencies,
} from "../core/dependencies.js";
import {
  AddNoteInput,
  LabelCreateInput,
  ProjectCreateInput,
  SearchInput,
  SetStatusInput,
  TaskCreateInput,
  TaskListFilter,
  TaskUpdateInput,
} from "../core/types.js";

const { db } = openDb();
const app = new Hono();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const taskIdParam = z.object({ taskId: z.coerce.number().int().positive() });

app.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);
  return c.json({ error: msg }, 400);
});

app.get("/health", (c) => c.json({ ok: true }));

app.get("/context", (c) => c.json(getContext(db)));

app.get(
  "/tasks",
  zValidator("query", TaskListFilter.partial()),
  (c) => c.json(listTasks(db, c.req.valid("query"))),
);

app.get("/tasks/:id", zValidator("param", idParam), (c) => {
  const { id } = c.req.valid("param");
  const t = getTask(db, id);
  return t ? c.json(t) : c.json({ error: `Task #${id} not found` }, 404);
});

app.post("/tasks", zValidator("json", TaskCreateInput), (c) =>
  c.json(createTask(db, c.req.valid("json")), 201),
);

app.patch(
  "/tasks/:id",
  zValidator("param", idParam),
  zValidator("json", TaskUpdateInput),
  (c) => {
    const { id } = c.req.valid("param");
    const row = updateTask(db, id, c.req.valid("json"));
    return row ? c.json(row) : c.json({ error: `Task #${id} not found` }, 404);
  },
);

app.post(
  "/tasks/:id/status",
  zValidator("param", idParam),
  zValidator("json", SetStatusInput),
  (c) => {
    const { id } = c.req.valid("param");
    return c.json(setStatus(db, id, c.req.valid("json")));
  },
);

app.put(
  "/tasks/:id/plan",
  zValidator("param", idParam),
  zValidator("json", z.object({ plan: z.string().max(20000) })),
  (c) => {
    const { id } = c.req.valid("param");
    const { plan } = c.req.valid("json");
    return c.json(setPlan(db, id, plan));
  },
);

app.post(
  "/tasks/:id/notes",
  zValidator("param", idParam),
  zValidator("json", AddNoteInput),
  (c) => {
    const { id } = c.req.valid("param");
    return c.json(addNote(db, id, c.req.valid("json")), 201);
  },
);

app.delete("/tasks/:id", zValidator("param", idParam), (c) => {
  const { id } = c.req.valid("param");
  return c.json({ deleted: deleteTask(db, id) });
});

app.get(
  "/search",
  zValidator("query", SearchInput.partial().required({ q: true })),
  (c) => c.json(searchTasks(db, c.req.valid("query") as z.infer<typeof SearchInput>)),
);

// Subtasks
app.post(
  "/tasks/:taskId/subtasks",
  zValidator("param", taskIdParam),
  zValidator("json", z.object({ title: z.string().min(1).max(500) })),
  (c) => {
    const { taskId } = c.req.valid("param");
    const { title } = c.req.valid("json");
    return c.json(addSubtask(db, taskId, title), 201);
  },
);

app.get("/tasks/:taskId/subtasks", zValidator("param", taskIdParam), (c) =>
  c.json(listSubtasks(db, c.req.valid("param").taskId)),
);

app.patch(
  "/subtasks/:id",
  zValidator("param", idParam),
  zValidator("json", z.object({ done: z.boolean() })),
  (c) => {
    const { id } = c.req.valid("param");
    const { done } = c.req.valid("json");
    return c.json(setSubtaskDone(db, id, done));
  },
);

app.delete("/subtasks/:id", zValidator("param", idParam), (c) =>
  c.json({ deleted: deleteSubtask(db, c.req.valid("param").id) }),
);

// Dependencies
app.post(
  "/tasks/:taskId/dependencies",
  zValidator("param", taskIdParam),
  zValidator(
    "json",
    z.object({ dependsOnTaskId: z.number().int().positive() }),
  ),
  (c) => {
    const { taskId } = c.req.valid("param");
    const { dependsOnTaskId } = c.req.valid("json");
    addDependency(db, taskId, dependsOnTaskId);
    return c.json({ taskId, dependsOnTaskId }, 201);
  },
);

app.delete(
  "/tasks/:taskId/dependencies/:depId",
  zValidator(
    "param",
    z.object({
      taskId: z.coerce.number().int().positive(),
      depId: z.coerce.number().int().positive(),
    }),
  ),
  (c) => {
    const { taskId, depId } = c.req.valid("param");
    return c.json({ removed: removeDependency(db, taskId, depId) });
  },
);

app.get("/tasks/:taskId/dependencies", zValidator("param", taskIdParam), (c) =>
  c.json(listDependencies(db, c.req.valid("param").taskId)),
);

// Projects
app.get("/projects", (c) =>
  c.json(listProjects(db, c.req.query("includeArchived") === "true")),
);

app.post("/projects", zValidator("json", ProjectCreateInput), (c) =>
  c.json(createProject(db, c.req.valid("json")), 201),
);

app.post(
  "/projects/:id/archive",
  zValidator("param", z.object({ id: z.string() })),
  (c) => {
    const { id } = c.req.valid("param");
    const row = archiveProject(db, id);
    return row ? c.json(row) : c.json({ error: `Project ${id} not found` }, 404);
  },
);

// Labels
app.get("/labels", (c) => c.json(listLabels(db)));

app.post("/labels", zValidator("json", LabelCreateInput), (c) =>
  c.json(createLabel(db, c.req.valid("json")), 201),
);

app.post(
  "/tasks/:taskId/labels/:label",
  zValidator(
    "param",
    z.object({
      taskId: z.coerce.number().int().positive(),
      label: z.string().min(1).max(64),
    }),
  ),
  (c) => {
    const { taskId, label } = c.req.valid("param");
    return c.json(tagTask(db, taskId, label));
  },
);

app.delete(
  "/tasks/:taskId/labels/:label",
  zValidator(
    "param",
    z.object({
      taskId: z.coerce.number().int().positive(),
      label: z.string().min(1).max(64),
    }),
  ),
  (c) => {
    const { taskId, label } = c.req.valid("param");
    return c.json({ removed: untagTask(db, taskId, label) });
  },
);

const port = Number(process.env.PORT ?? 3939);
serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.error(`[tasks-mcp] REST listening on http://localhost:${info.port}`);
});
