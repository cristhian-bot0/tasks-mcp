import { and, eq } from "drizzle-orm";
import type { DB } from "./db.js";
import { labels, taskLabels } from "./schema.js";
import { LabelCreateInput } from "./types.js";
import type { z } from "zod";

export function createLabel(db: DB, input: z.infer<typeof LabelCreateInput>) {
  const parsed = LabelCreateInput.parse(input);
  return db.insert(labels).values(parsed).returning().get();
}

export function listLabels(db: DB) {
  return db.select().from(labels).all();
}

export function getOrCreateLabel(db: DB, name: string) {
  const existing = db.select().from(labels).where(eq(labels.name, name)).get();
  if (existing) return existing;
  return db.insert(labels).values({ name }).returning().get();
}

export function tagTask(db: DB, taskId: number, labelName: string) {
  const label = getOrCreateLabel(db, labelName);
  db.insert(taskLabels)
    .values({ taskId, labelId: label.id })
    .onConflictDoNothing()
    .run();
  return label;
}

export function untagTask(db: DB, taskId: number, labelName: string) {
  const label = db
    .select()
    .from(labels)
    .where(eq(labels.name, labelName))
    .get();
  if (!label) return false;
  const res = db
    .delete(taskLabels)
    .where(
      and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, label.id)),
    )
    .run();
  return res.changes > 0;
}

export function getTaskLabels(db: DB, taskId: number) {
  return db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.labelId, labels.id))
    .where(eq(taskLabels.taskId, taskId))
    .all();
}
