import { and, eq, max } from "drizzle-orm";
import type { DB } from "./db.js";
import { subtasks } from "./schema.js";

export function addSubtask(db: DB, taskId: number, title: string) {
  const lastPos =
    db
      .select({ m: max(subtasks.position) })
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId))
      .get()?.m ?? -1;
  return db
    .insert(subtasks)
    .values({ taskId, title, position: lastPos + 1 })
    .returning()
    .get();
}

export function listSubtasks(db: DB, taskId: number) {
  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(subtasks.position)
    .all();
}

export function setSubtaskDone(db: DB, subtaskId: number, done: boolean) {
  return db
    .update(subtasks)
    .set({ done })
    .where(eq(subtasks.id, subtaskId))
    .returning()
    .get();
}

export function deleteSubtask(db: DB, subtaskId: number) {
  const res = db.delete(subtasks).where(eq(subtasks.id, subtaskId)).run();
  return res.changes > 0;
}

export function hasOpenSubtasks(db: DB, taskId: number): boolean {
  const open = db
    .select()
    .from(subtasks)
    .where(and(eq(subtasks.taskId, taskId), eq(subtasks.done, false)))
    .get();
  return open !== undefined;
}
