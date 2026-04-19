import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "./db.js";
import { notes, tasks, taskLabels, labels } from "./schema.js";
import {
  AddNoteInput,
  SearchInput,
  SetStatusInput,
  TaskCreateInput,
  TaskListFilter,
  TaskUpdateInput,
  type Status,
} from "./types.js";
import type { z } from "zod";
import { tagTask, getTaskLabels } from "./labels.js";
import { listSubtasks, hasOpenSubtasks } from "./subtasks.js";
import { listDependencies } from "./dependencies.js";

export function createTask(db: DB, input: z.infer<typeof TaskCreateInput>) {
  const parsed = TaskCreateInput.parse(input);
  const { labels: labelNames, ...rest } = parsed;
  const row = db
    .insert(tasks)
    .values({
      ...rest,
      startedAt: rest.status === "doing" ? new Date() : null,
      completedAt: rest.status === "done" ? new Date() : null,
    })
    .returning()
    .get();
  if (labelNames?.length) {
    for (const name of labelNames) tagTask(db, row.id, name);
  }
  return row;
}

export function updateTask(
  db: DB,
  id: number,
  input: z.infer<typeof TaskUpdateInput>,
) {
  const parsed = TaskUpdateInput.parse(input);
  const row = db
    .update(tasks)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function getTask(db: DB, id: number) {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!row) return null;
  return {
    ...row,
    labels: getTaskLabels(db, id),
    subtasks: listSubtasks(db, id),
    dependsOn: listDependencies(db, id),
    notes: listNotes(db, id),
  };
}

export function listTasks(db: DB, filter: z.infer<typeof TaskListFilter> = {}) {
  const f = TaskListFilter.parse(filter);
  const conds = [];
  if (f.status) {
    const arr = Array.isArray(f.status) ? f.status : [f.status];
    conds.push(inArray(tasks.status, arr));
  }
  if (f.projectId) conds.push(eq(tasks.projectId, f.projectId));
  if (f.priority) conds.push(eq(tasks.priority, f.priority));
  if (f.dueBefore) conds.push(lte(tasks.dueAt, f.dueBefore));

  let rows;
  const limit = f.limit ?? 100;

  if (f.label) {
    rows = db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(taskLabels, eq(taskLabels.taskId, tasks.id))
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(and(eq(labels.name, f.label), ...conds))
      .orderBy(desc(tasks.priority), asc(tasks.dueAt), desc(tasks.createdAt))
      .limit(limit)
      .all()
      .map((r) => r.task);
  } else {
    rows = db
      .select()
      .from(tasks)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(tasks.priority), asc(tasks.dueAt), desc(tasks.createdAt))
      .limit(limit)
      .all();
  }

  return rows;
}

export function setStatus(
  db: DB,
  id: number,
  input: z.infer<typeof SetStatusInput>,
) {
  const { status, reason } = SetStatusInput.parse(input);
  if (status === "done" && hasOpenSubtasks(db, id)) {
    throw new Error(
      `Cannot mark task #${id} as done: it has open subtasks. Complete or delete them first.`,
    );
  }
  const patch: Partial<{
    status: Status;
    blockedReason: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    updatedAt: Date;
  }> = { status, updatedAt: new Date() };
  if (status === "blocked") patch.blockedReason = reason ?? null;
  else patch.blockedReason = null;
  if (status === "doing") patch.startedAt = new Date();
  if (status === "done" || status === "cancelled") {
    patch.completedAt = new Date();
  }
  return db
    .update(tasks)
    .set(patch)
    .where(eq(tasks.id, id))
    .returning()
    .get();
}

export function setPlan(db: DB, id: number, plan: string) {
  return db
    .update(tasks)
    .set({ plan, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning()
    .get();
}

export function addNote(
  db: DB,
  taskId: number,
  input: z.infer<typeof AddNoteInput>,
) {
  const parsed = AddNoteInput.parse(input);
  return db
    .insert(notes)
    .values({ taskId, ...parsed })
    .returning()
    .get();
}

export function listNotes(db: DB, taskId: number) {
  return db
    .select()
    .from(notes)
    .where(eq(notes.taskId, taskId))
    .orderBy(asc(notes.createdAt))
    .all();
}

export function deleteTask(db: DB, id: number) {
  const res = db.delete(tasks).where(eq(tasks.id, id)).run();
  return res.changes > 0;
}

export function searchTasks(db: DB, input: z.infer<typeof SearchInput>) {
  const { q, limit = 20 } = SearchInput.parse(input);
  const ftsQuery = escapeFts(q);
  const rows = db.all<{ id: number }>(sql`
    SELECT rowid AS id FROM tasks_fts
    WHERE tasks_fts MATCH ${ftsQuery}
    ORDER BY rank
    LIMIT ${limit}
  `);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const byId = new Map(
    db.select().from(tasks).where(inArray(tasks.id, ids)).all().map((t) => [t.id, t]),
  );
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function escapeFts(q: string): string {
  const cleaned = q.replace(/["\\]/g, " ").trim();
  if (!cleaned) return '""';
  const terms = cleaned.split(/\s+/).filter(Boolean);
  return terms.map((t) => `"${t}"*`).join(" ");
}
