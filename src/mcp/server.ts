#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  NoteKindEnum,
  PriorityEnum,
  ProjectCreateInput,
  SearchInput,
  SetStatusInput,
  StatusEnum,
  TaskCreateInput,
  TaskListFilter,
  TaskUpdateInput,
} from "../core/types.js";

const { db } = openDb();

const server = new McpServer(
  {
    name: "tasks-mcp",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
    instructions:
      "Local task backend. Use `get_context` at the start of work to see pending tasks, " +
      "what is in progress, and blockers. Before creating a task, use `search_tasks` to avoid duplicates. " +
      "Store execution plans with `set_plan` and record attempts/insights with `add_note`.",
  },
);

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
  };
}

server.registerTool(
  "get_context",
  {
    description:
      "Returns a snapshot of in-progress tasks, blockers, top-priority todos, and items due soon. Call this at the start of a conversation.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(getContext(db));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_tasks",
  {
    description:
      "List tasks with optional filters (status, project, label, priority, dueBefore).",
    inputSchema: TaskListFilter.shape,
  },
  async (args) => {
    try {
      return ok(listTasks(db, args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "get_task",
  {
    description:
      "Return full detail for a task (subtasks, dependencies, notes, labels).",
    inputSchema: { id: z.number().int().positive() },
  },
  async ({ id }) => {
    const t = getTask(db, id);
    return t ? ok(t) : fail(`Task #${id} not found`);
  },
);

server.registerTool(
  "create_task",
  {
    description:
      "Create a new task. Consider calling `search_tasks` first to avoid duplicates.",
    inputSchema: TaskCreateInput.shape,
  },
  async (args) => {
    try {
      return ok(createTask(db, args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "update_task",
  {
    description: "Update mutable fields on an existing task.",
    inputSchema: { id: z.number().int().positive(), ...TaskUpdateInput.shape },
  },
  async ({ id, ...patch }) => {
    try {
      const row = updateTask(db, id, patch);
      return row ? ok(row) : fail(`Task #${id} not found`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "set_status",
  {
    description:
      "Change the status of a task. Use 'blocked' with a reason to pause work. Marking 'done' requires all subtasks completed.",
    inputSchema: {
      id: z.number().int().positive(),
      status: StatusEnum,
      reason: z.string().max(1000).optional(),
    },
  },
  async ({ id, status, reason }) => {
    try {
      return ok(setStatus(db, id, { status, reason }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "set_plan",
  {
    description:
      "Save the execution plan for a task (the approach you intend to take).",
    inputSchema: {
      id: z.number().int().positive(),
      plan: z.string().max(20000),
    },
  },
  async ({ id, plan }) => {
    try {
      return ok(setPlan(db, id, plan));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "add_note",
  {
    description:
      "Append a note to a task. Use kind='attempt' for tried approaches, 'blocker' for obstacles, 'insight' for learnings.",
    inputSchema: {
      taskId: z.number().int().positive(),
      body: z.string().min(1).max(20000),
      kind: NoteKindEnum.default("comment"),
    },
  },
  async ({ taskId, body, kind }) => {
    try {
      return ok(addNote(db, taskId, { body, kind }));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "delete_task",
  {
    description:
      "Delete a task permanently. Prefer set_status with 'cancelled' unless you really need to remove history.",
    inputSchema: { id: z.number().int().positive() },
  },
  async ({ id }) => {
    try {
      return ok({ deleted: deleteTask(db, id) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "search_tasks",
  {
    description:
      "Full-text search across task titles, descriptions, plans, and context.",
    inputSchema: SearchInput.shape,
  },
  async (args) => {
    try {
      return ok(searchTasks(db, args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "add_subtask",
  {
    description: "Add a subtask (checklist item) to a task.",
    inputSchema: {
      taskId: z.number().int().positive(),
      title: z.string().min(1).max(500),
    },
  },
  async ({ taskId, title }) => {
    try {
      return ok(addSubtask(db, taskId, title));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_subtasks",
  {
    description: "List all subtasks for a task.",
    inputSchema: { taskId: z.number().int().positive() },
  },
  async ({ taskId }) => ok(listSubtasks(db, taskId)),
);

server.registerTool(
  "set_subtask_done",
  {
    description: "Mark a subtask as done or undone.",
    inputSchema: {
      subtaskId: z.number().int().positive(),
      done: z.boolean(),
    },
  },
  async ({ subtaskId, done }) => {
    try {
      return ok(setSubtaskDone(db, subtaskId, done));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "delete_subtask",
  {
    description: "Remove a subtask.",
    inputSchema: { subtaskId: z.number().int().positive() },
  },
  async ({ subtaskId }) => ok({ deleted: deleteSubtask(db, subtaskId) }),
);

server.registerTool(
  "add_dependency",
  {
    description:
      "Mark that taskId depends on dependsOnTaskId. Fails if it would create a cycle.",
    inputSchema: {
      taskId: z.number().int().positive(),
      dependsOnTaskId: z.number().int().positive(),
    },
  },
  async ({ taskId, dependsOnTaskId }) => {
    try {
      addDependency(db, taskId, dependsOnTaskId);
      return ok({ taskId, dependsOnTaskId });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "remove_dependency",
  {
    description: "Remove a dependency edge.",
    inputSchema: {
      taskId: z.number().int().positive(),
      dependsOnTaskId: z.number().int().positive(),
    },
  },
  async ({ taskId, dependsOnTaskId }) =>
    ok({ removed: removeDependency(db, taskId, dependsOnTaskId) }),
);

server.registerTool(
  "list_dependencies",
  {
    description: "List task IDs that the given task depends on.",
    inputSchema: { taskId: z.number().int().positive() },
  },
  async ({ taskId }) => ok(listDependencies(db, taskId)),
);

server.registerTool(
  "list_projects",
  {
    description: "List projects (excludes archived unless includeArchived=true).",
    inputSchema: { includeArchived: z.boolean().optional() },
  },
  async ({ includeArchived }) =>
    ok(listProjects(db, includeArchived ?? false)),
);

server.registerTool(
  "create_project",
  {
    description: "Create a project (board) to group tasks.",
    inputSchema: ProjectCreateInput.shape,
  },
  async (args) => {
    try {
      return ok(createProject(db, args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "archive_project",
  {
    description: "Archive a project (tasks remain).",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const row = archiveProject(db, id);
      return row ? ok(row) : fail(`Project ${id} not found`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "list_labels",
  {
    description: "List all labels.",
    inputSchema: {},
  },
  async () => ok(listLabels(db)),
);

server.registerTool(
  "create_label",
  {
    description: "Create a label. Idempotent — returns the existing one if name exists.",
    inputSchema: LabelCreateInput.shape,
  },
  async (args) => {
    try {
      return ok(createLabel(db, args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "tag_task",
  {
    description: "Attach a label (by name) to a task. Creates the label if it does not exist.",
    inputSchema: {
      taskId: z.number().int().positive(),
      label: z.string().min(1).max(64),
    },
  },
  async ({ taskId, label }) => {
    try {
      return ok(tagTask(db, taskId, label));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "untag_task",
  {
    description: "Remove a label from a task.",
    inputSchema: {
      taskId: z.number().int().positive(),
      label: z.string().min(1).max(64),
    },
  },
  async ({ taskId, label }) => ok({ removed: untagTask(db, taskId, label) }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

// Reference unused enums to keep bundlers/treeshaking from complaining.
void PriorityEnum;
void AddNoteInput;
void SetStatusInput;
