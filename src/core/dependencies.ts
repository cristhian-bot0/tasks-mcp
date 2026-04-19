import { and, eq } from "drizzle-orm";
import type { DB } from "./db.js";
import { dependencies } from "./schema.js";

export function addDependency(
  db: DB,
  taskId: number,
  dependsOnTaskId: number,
) {
  if (taskId === dependsOnTaskId) {
    throw new Error("A task cannot depend on itself");
  }
  if (wouldCreateCycle(db, taskId, dependsOnTaskId)) {
    throw new Error(
      `Dependency would create a cycle: ${taskId} → ${dependsOnTaskId}`,
    );
  }
  db.insert(dependencies)
    .values({ taskId, dependsOnTaskId })
    .onConflictDoNothing()
    .run();
}

export function removeDependency(
  db: DB,
  taskId: number,
  dependsOnTaskId: number,
) {
  const res = db
    .delete(dependencies)
    .where(
      and(
        eq(dependencies.taskId, taskId),
        eq(dependencies.dependsOnTaskId, dependsOnTaskId),
      ),
    )
    .run();
  return res.changes > 0;
}

export function listDependencies(db: DB, taskId: number) {
  return db
    .select()
    .from(dependencies)
    .where(eq(dependencies.taskId, taskId))
    .all()
    .map((r) => r.dependsOnTaskId);
}

function wouldCreateCycle(
  db: DB,
  taskId: number,
  dependsOnTaskId: number,
): boolean {
  const visited = new Set<number>();
  const stack = [dependsOnTaskId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = db
      .select()
      .from(dependencies)
      .where(eq(dependencies.taskId, current))
      .all();
    for (const d of deps) stack.push(d.dependsOnTaskId);
  }
  return false;
}
