# Architecture & Contributing Guide

This document explains **how the project is organized** and **how to add new functionality** without fighting the structure. Read it before touching anything beyond a typo.

---

## 1. Mental model: one core, two facades

```
        ┌─────────────┐   ┌─────────────┐
        │  MCP tool   │   │ REST route  │   ← facades (transports)
        │  wrapper    │   │  wrapper    │
        └──────┬──────┘   └──────┬──────┘
               │                 │
               ▼                 ▼
          ┌──────────────────────────┐
          │         core/…           │   ← pure domain logic
          │  createTask, setStatus,  │     No transport, no I/O
          │  addDependency, …        │     besides the DB.
          └─────────────┬────────────┘
                        ▼
                  ┌───────────┐
                  │  SQLite   │
                  └───────────┘
```

**The single rule that keeps this project maintainable**: the facades (`src/mcp/server.ts`, `src/rest/server.ts`) **must stay thin**. They do three things only:

1. Parse input (delegated to Zod schemas from `src/core/types.ts`).
2. Call a function in `src/core/`.
3. Shape the result into their transport (MCP tool result / HTTP JSON).

If you find yourself writing business logic, a DB query, or a conditional about task state **inside a facade**, stop and move it to `src/core/`. Both facades must behave identically for the same inputs — putting logic in one side silently diverges them.

---

## 2. Directory layout

```
src/
├── core/
│   ├── schema.ts        Drizzle table definitions — source of truth for data shape
│   ├── migrate.ts       Embedded DDL, applied on every connection open
│   ├── db.ts            Connection singleton, WAL + FK pragmas, lazy init
│   ├── types.ts         Zod schemas shared by both facades
│   ├── tasks.ts         Task CRUD, status transitions, FTS search
│   ├── projects.ts
│   ├── labels.ts
│   ├── subtasks.ts
│   ├── dependencies.ts  Cycle detection via DFS
│   └── context.ts       get_context dashboard summary
├── mcp/
│   └── server.ts        stdio facade — each tool is ~5 lines of wrapper
└── rest/
    └── server.ts        Hono facade — each route is ~5 lines of wrapper

test/
├── helpers.ts           createTestDb() — in-memory SQLite with DDL applied
└── core.test.ts         Vitest cases covering the domain layer
```

---

## 3. Request lifecycle

Suppose an agent calls `create_task` via MCP.

1. **Transport arrives**. `@modelcontextprotocol/sdk` receives a JSON-RPC `tools/call` message over stdio.
2. **Schema validation**. The SDK runs the input against `TaskCreateInput` (the Zod shape registered on the tool) and rejects malformed input with a typed error before our handler runs.
3. **Facade wrapper** in `src/mcp/server.ts`:
   ```ts
   async (args) => {
     try { return ok(createTask(db, args)); }
     catch (e) { return fail(e); }
   }
   ```
   That's the entire MCP-side logic — delegate to core, wrap the outcome.
4. **Core call** in `src/core/tasks.ts`: `createTask` validates again defensively, inserts through Drizzle, returns the full row.
5. **Return**. The facade wraps the row in `{ content: [{ type: "text", text: JSON.stringify(...) }] }` for MCP, or `c.json(row, 201)` for REST.

The REST path (`POST /tasks`) is structurally identical — the same `createTask` function runs. That is why both facades stay in sync without effort.

---

## 4. Data layer conventions

- **Drizzle is the source of truth** for TypeScript types (`tasks.$inferSelect`, etc.), but DDL is applied via the raw SQL in `migrate.ts`. Those two must stay equivalent. If you change `schema.ts`, mirror the change in `migrate.ts` and in the `CREATE TRIGGER` blocks if the FTS-indexed columns are involved.
- **Always enable FK checks**: `raw.pragma("foreign_keys = ON")` in `db.ts` guarantees cascades work as declared.
- **WAL mode is set** on open — safe for a local single-writer process; do not revert to `DELETE` journal without reason.
- **Timestamps**: use `integer timestamp_ms`. Pass `new Date()` in TS; Drizzle handles the conversion.

---

## 5. Adding a new feature: the recipe

Treat this as the default flow for any new task/operation. Skip steps only if you have a concrete reason.

### Example: add `duplicate_task` — clone a task (title + plan + context) as a new `todo`

**Step 1 — Schema change (if needed).** In this example, no new columns; skip.

**Step 2 — Zod input schema.** In `src/core/types.ts`:

```ts
export const DuplicateTaskInput = z.object({
  id: z.number().int().positive(),
  newTitle: z.string().min(1).max(500).optional(),
});
```

Reuse existing schemas where you can — the fewer input shapes, the less drift.

**Step 3 — Core function.** In `src/core/tasks.ts`:

```ts
export function duplicateTask(
  db: DB,
  input: z.infer<typeof DuplicateTaskInput>,
) {
  const { id, newTitle } = DuplicateTaskInput.parse(input);
  const original = getTask(db, id);
  if (!original) throw new Error(`Task #${id} not found`);
  return createTask(db, {
    title: newTitle ?? `${original.title} (copy)`,
    description: original.description ?? undefined,
    projectId: original.projectId ?? undefined,
    priority: original.priority,
    plan: original.plan ?? undefined,
    context: original.context ?? undefined,
    labels: original.labels.map((l) => l.name),
  });
}
```

Notice this reuses `getTask` and `createTask`. Compose, don't duplicate.

**Step 4 — Unit tests.** In `test/core.test.ts`:

```ts
it("duplicates a task including labels", () => {
  createProject(db, { id: "p", name: "P" });
  const orig = createTask(db, {
    title: "original", projectId: "p", labels: ["a", "b"],
  });
  const dup = duplicateTask(db, { id: orig.id });
  expect(dup.title).toBe("original (copy)");
  const full = getTask(db, dup.id)!;
  expect(full.labels.map((l) => l.name).sort()).toEqual(["a", "b"]);
});
```

Always test the core module, not the facades. Facades are too thin to warrant their own tests.

**Step 5 — MCP tool.** In `src/mcp/server.ts`:

```ts
server.registerTool(
  "duplicate_task",
  {
    description: "Clone a task as a new 'todo'. Keeps title, plan, context, labels.",
    inputSchema: {
      id: z.number().int().positive(),
      newTitle: z.string().min(1).max(500).optional(),
    },
  },
  async (args) => {
    try { return ok(duplicateTask(db, args)); }
    catch (e) { return fail(e); }
  },
);
```

**Step 6 — REST endpoint.** In `src/rest/server.ts`:

```ts
app.post(
  "/tasks/:id/duplicate",
  zValidator("param", idParam),
  zValidator("json", z.object({ newTitle: z.string().optional() }).optional()),
  (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json") ?? {};
    return c.json(duplicateTask(db, { id, ...body }), 201);
  },
);
```

Both facades call the same core function, so behavior is guaranteed identical.

**Step 7 — Update docs.** Add the tool/endpoint to the MCP tools table and REST endpoints block in both `README.md` and `README.es.md`.

**Step 8 — Rebuild.** `npm run build`. Clients that launch the server via `node dist/mcp/server.js` (which is how the MCP registration points) read compiled JS, so skipping the build means your change is invisible to them.

**Step 9 — Verify end-to-end.**

```bash
npm test                     # must stay green
npm run dev:rest &
curl -X POST http://localhost:3939/tasks/1/duplicate -d '{}' -H 'content-type: application/json'
```

In MCP clients, restart the session (the tool list is frozen at connect time). A quick sanity check is `claude mcp list | grep tasks` still reports `✓ Connected`.

---

## 6. Schema evolution

When you need to change tables:

1. Edit `src/core/schema.ts` (Drizzle definitions).
2. Mirror the same change as SQL in `src/core/migrate.ts`. Use `ALTER TABLE` if you need to preserve existing data, not `CREATE TABLE IF NOT EXISTS`.
3. Update the FTS triggers in `migrate.ts` if you changed any of the indexed columns (`title`, `description`, `plan`, `context`).
4. If you want versioned migration files instead of the embedded DDL, run `npm run db:generate` — drizzle-kit will write SQL into `drizzle/`. The current setup ignores those files; wire them in via `drizzle-orm/better-sqlite3/migrator` if you adopt that flow.
5. Update tests that rely on the old shape.

For **destructive migrations** against a real database, stop the MCP server and any REST server first (they hold WAL locks), back up `data/tasks.db`, then apply the change and restart.

---

## 7. Error handling

- **Core throws `Error`** with a descriptive message. No special error classes — keep it simple.
- **MCP facade** converts thrown errors into `{ isError: true, content: [...] }`. Agents see the message.
- **REST facade** has an `app.onError` that returns `{ error: message }` with a 400 status. If you need 404/409/etc., handle that in the route and return before the error surface.
- Do not leak internal SQLite or Drizzle errors directly to the transport — wrap them with a meaningful message at the core boundary if they'd be opaque.

---

## 8. Validation placement

Validation runs in **three places intentionally**:

1. **Facade boundary** — transport-level schema on the MCP tool / Hono `zValidator`. Rejects malformed transport payloads early.
2. **Core function entry** — `Schema.parse(input)` inside the function. This is the authoritative guard; treat the facade as best-effort.
3. **Database constraints** — CHECK constraints on enums, FOREIGN KEYs, PRIMARY KEYs with CHECK for self-dependency. Last line of defense.

This looks redundant but pays off: the core is callable from tests, a future CLI, or a future WebSocket facade without re-validating, and the DB stays internally consistent regardless of caller.

---

## 9. Running everything during development

```bash
npm run dev:rest              # auto-reload HTTP
npm run dev:mcp               # stdio; pipe an MCP inspector into it
npm test                      # watch with: npm run test:watch
npm run build                 # required before MCP clients pick up changes
```

The MCP registration in user scope points at `dist/mcp/server.js`. During iteration, prefer the REST facade and `curl`/`httpie` for fast feedback. Rebuild and restart the MCP client session only when you're ready to test the MCP path specifically.

---

## 10. Commit conventions

- Conventional-ish prefixes: `feat(core)`, `feat(mcp)`, `feat(rest)`, `fix`, `docs`, `test`, `refactor`, `chore`.
- One logical change per commit. Mixing a schema change and a new tool in the same commit is a code-review hazard.
- Write in English so the repo reads consistently for any contributor.
- Body explains the **why**. Code already shows the **what**.

---

## 11. Out of scope (for now)

Before opening a PR that adds any of these, discuss in an issue first — they change the architecture, not just the surface:

- Multi-tenant / multi-user — would require auth and a user-scoped core.
- Remote sync — would require a server replica of the core against Postgres/libsql.
- Web UI — fine as a separate app consuming REST, not as a route inside the facade server.
- WebSocket or SSE facade — doable, but a third facade means a third place that can drift from the other two.
