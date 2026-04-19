import type { DB } from "./db.js";
import { listTasks } from "./tasks.js";

export interface ContextSummary {
  doing: ReturnType<typeof listTasks>;
  blocked: ReturnType<typeof listTasks>;
  upNext: ReturnType<typeof listTasks>;
  dueSoon: ReturnType<typeof listTasks>;
  counts: {
    todo: number;
    doing: number;
    blocked: number;
  };
}

export function getContext(db: DB): ContextSummary {
  const doing = listTasks(db, { status: "doing", limit: 20 });
  const blocked = listTasks(db, { status: "blocked", limit: 20 });
  const upNext = listTasks(db, { status: "todo", limit: 10 });

  const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const dueSoon = listTasks(db, {
    status: ["todo", "doing"],
    dueBefore: twoWeeks,
    limit: 10,
  });

  return {
    doing,
    blocked,
    upNext,
    dueSoon,
    counts: {
      todo: listTasks(db, { status: "todo", limit: 500 }).length,
      doing: doing.length,
      blocked: blocked.length,
    },
  };
}
