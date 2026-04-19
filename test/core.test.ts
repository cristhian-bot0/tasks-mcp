import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers.js";
import type { DB } from "../src/core/db.js";
import {
  createTask,
  getTask,
  listTasks,
  setStatus,
  setPlan,
  addNote,
  updateTask,
  searchTasks,
} from "../src/core/tasks.js";
import { createProject } from "../src/core/projects.js";
import {
  addSubtask,
  setSubtaskDone,
} from "../src/core/subtasks.js";
import {
  addDependency,
  listDependencies,
} from "../src/core/dependencies.js";
import { getContext } from "../src/core/context.js";

let db: DB;

beforeEach(() => {
  ({ db } = createTestDb());
});

describe("tasks", () => {
  it("creates a task with defaults", () => {
    const t = createTask(db, { title: "write tests" });
    expect(t.id).toBeGreaterThan(0);
    expect(t.status).toBe("todo");
    expect(t.priority).toBe("med");
    expect(t.title).toBe("write tests");
  });

  it("creates a task with labels, project, plan, and context", () => {
    createProject(db, { id: "auth", name: "Auth" });
    const t = createTask(db, {
      title: "fix login",
      projectId: "auth",
      priority: "high",
      plan: "Step 1: reproduce. Step 2: fix.",
      context: "reported by user X",
      labels: ["bug", "regression"],
    });
    const full = getTask(db, t.id);
    expect(full).not.toBeNull();
    expect(full!.labels.map((l) => l.name).sort()).toEqual([
      "bug",
      "regression",
    ]);
    expect(full!.plan).toContain("Step 1");
    expect(full!.projectId).toBe("auth");
  });

  it("updates mutable fields", () => {
    const t = createTask(db, { title: "x" });
    const updated = updateTask(db, t.id, {
      title: "y",
      description: "new desc",
    });
    expect(updated!.title).toBe("y");
    expect(updated!.description).toBe("new desc");
  });

  it("lists with status filter", () => {
    createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    setStatus(db, b.id, { status: "doing" });
    const doing = listTasks(db, { status: "doing" });
    expect(doing.map((t) => t.title)).toEqual(["b"]);
  });

  it("orders by priority then due date", () => {
    const low = createTask(db, { title: "low", priority: "low" });
    const urgent = createTask(db, { title: "u", priority: "urgent" });
    const med = createTask(db, { title: "m", priority: "med" });
    const rows = listTasks(db);
    // priority ordering: urgent > med > low (SQLite TEXT sort is not semantic,
    // so we rely on alphabetical desc: urgent, med, low)
    expect(rows.length).toBe(3);
    expect(rows[0]?.id).toBe(urgent.id);
    expect(rows.at(-1)?.id).toBe(low.id);
    void med;
  });
});

describe("status transitions", () => {
  it("sets startedAt when moving to doing", () => {
    const t = createTask(db, { title: "x" });
    const updated = setStatus(db, t.id, { status: "doing" });
    expect(updated.startedAt).toBeInstanceOf(Date);
  });

  it("sets completedAt when moving to done", () => {
    const t = createTask(db, { title: "x" });
    const updated = setStatus(db, t.id, { status: "done" });
    expect(updated.completedAt).toBeInstanceOf(Date);
  });

  it("records blocked reason and clears it on unblock", () => {
    const t = createTask(db, { title: "x" });
    const blocked = setStatus(db, t.id, {
      status: "blocked",
      reason: "waiting for review",
    });
    expect(blocked.blockedReason).toBe("waiting for review");
    const unblocked = setStatus(db, t.id, { status: "doing" });
    expect(unblocked.blockedReason).toBeNull();
  });

  it("refuses to mark done when open subtasks exist", () => {
    const t = createTask(db, { title: "x" });
    addSubtask(db, t.id, "step 1");
    expect(() => setStatus(db, t.id, { status: "done" })).toThrow(
      /open subtasks/,
    );
  });

  it("allows done when all subtasks are closed", () => {
    const t = createTask(db, { title: "x" });
    const s = addSubtask(db, t.id, "step 1");
    setSubtaskDone(db, s.id, true);
    const done = setStatus(db, t.id, { status: "done" });
    expect(done.status).toBe("done");
  });
});

describe("plan and notes", () => {
  it("set_plan updates plan", () => {
    const t = createTask(db, { title: "x" });
    const updated = setPlan(db, t.id, "my plan");
    expect(updated.plan).toBe("my plan");
  });

  it("add_note appends note of the right kind", () => {
    const t = createTask(db, { title: "x" });
    addNote(db, t.id, { body: "tried A, failed", kind: "attempt" });
    addNote(db, t.id, { body: "need help", kind: "blocker" });
    const full = getTask(db, t.id)!;
    expect(full.notes.length).toBe(2);
    expect(full.notes[0]?.kind).toBe("attempt");
    expect(full.notes[1]?.kind).toBe("blocker");
  });
});

describe("dependencies", () => {
  it("adds a dependency", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    addDependency(db, a.id, b.id);
    expect(listDependencies(db, a.id)).toEqual([b.id]);
  });

  it("rejects self-dependency", () => {
    const a = createTask(db, { title: "a" });
    expect(() => addDependency(db, a.id, a.id)).toThrow(/itself/);
  });

  it("rejects cycle", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c" });
    addDependency(db, a.id, b.id);
    addDependency(db, b.id, c.id);
    expect(() => addDependency(db, c.id, a.id)).toThrow(/cycle/);
  });
});

describe("search", () => {
  it("finds by title prefix", () => {
    createTask(db, { title: "refactor auth middleware" });
    createTask(db, { title: "write docs" });
    const results = searchTasks(db, { q: "auth" });
    expect(results.length).toBe(1);
    expect(results[0]!.title).toMatch(/auth/);
  });

  it("finds by plan content", () => {
    createTask(db, { title: "x", plan: "rewrite with zustand store" });
    const results = searchTasks(db, { q: "zustand" });
    expect(results.length).toBe(1);
  });
});

describe("context", () => {
  it("summarizes state", () => {
    const a = createTask(db, { title: "a" });
    setStatus(db, a.id, { status: "doing" });
    const b = createTask(db, { title: "b" });
    setStatus(db, b.id, { status: "blocked", reason: "r" });
    createTask(db, { title: "c", priority: "urgent" });

    const ctx = getContext(db);
    expect(ctx.doing.length).toBe(1);
    expect(ctx.blocked.length).toBe(1);
    expect(ctx.upNext.length).toBe(1);
    expect(ctx.counts.doing).toBe(1);
    expect(ctx.counts.blocked).toBe(1);
    expect(ctx.counts.todo).toBe(1);
  });
});
