import { eq, isNull } from "drizzle-orm";
import type { DB } from "./db.js";
import { projects } from "./schema.js";
import { ProjectCreateInput } from "./types.js";
import type { z } from "zod";

export function createProject(
  db: DB,
  input: z.infer<typeof ProjectCreateInput>,
) {
  const parsed = ProjectCreateInput.parse(input);
  return db.insert(projects).values(parsed).returning().get();
}

export function listProjects(db: DB, includeArchived = false) {
  const q = db.select().from(projects);
  return includeArchived ? q.all() : q.where(isNull(projects.archivedAt)).all();
}

export function getProject(db: DB, id: string) {
  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

export function archiveProject(db: DB, id: string) {
  return db
    .update(projects)
    .set({ archivedAt: new Date() })
    .where(eq(projects.id, id))
    .returning()
    .get();
}
