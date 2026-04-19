# tasks-mcp

**Language:** **English** · [Español](README.es.md)

A local task-management backend built **for LLMs to use as persistent memory**.

Unlike Trello, Linear, or Plane — which are optimized for human teams — `tasks-mcp` treats execution plans, attempt logs, and reasoning context as first-class fields. It exposes two facades over a single SQLite database:

- **MCP server (stdio)** — for any MCP-compatible agent (Claude Code, Cursor, Windsurf, Continue.dev, Cline, ChatGPT desktop, etc.).
- **REST API (HTTP + JSON)** — for models that only speak function calling (Gemini, Llama, Mistral, or your own agent code).

Both facades read and write the same database, so tasks created by one agent are immediately visible to another.

---

## Why not just Linear/Plane/Trello?

Those systems model a *human workflow*: assignee, sprint, status column, comments. This project models an *agent workflow*:

| Field | Purpose |
|---|---|
| `plan` | The approach the agent intends to take before starting |
| `context` | Why the task matters, constraints, references |
| `notes` with `kind` | Per-task log entries typed as `attempt`, `blocker`, `insight`, or `comment` |
| `status` state machine | Clear transitions with side effects (`startedAt`, `completedAt`, `blockedReason`) |
| Rich filters | Status, project, label, priority, due-date — all designed for one-shot LLM queries |

A chat with an LLM is ephemeral. This DB is not. Next session, the agent calls `get_context` and picks up where work stopped.

---

## Features

- **Rich task model**: projects, priorities (`low`/`med`/`high`/`urgent`), labels, subtasks, dependencies (cycle-checked), due dates.
- **LLM-specific fields**: `plan`, `context`, typed notes.
- **Full-text search** across titles, descriptions, plans, and context (SQLite FTS5).
- **Single SQLite file** — no services, no containers, no sync server.
- **Two facades**, one core: 25+ MCP tools and a parallel REST surface.
- **Type-safe**: TypeScript + Drizzle + Zod schemas shared between both facades.

---

## Installation

Prerequisites: Node.js ≥ 20, npm.

```bash
git clone https://github.com/<your-username>/tasks-mcp.git
cd tasks-mcp
npm install
npm run build
npm test          # 18 unit tests
```

The SQLite file is created automatically at `./data/tasks.db` on first run. Override the path with `TASKS_DB_PATH=/absolute/path/to/tasks.db`.

---

## Connecting to MCP clients

### Claude Code

```bash
claude mcp add --scope user tasks \
  node /absolute/path/to/tasks-mcp/dist/mcp/server.js
```

`--scope user` makes the server available across every working directory. Verify:

```bash
claude mcp list | grep tasks
# tasks: node /.../dist/mcp/server.js - ✓ Connected
```

### Cursor / Windsurf / Continue.dev / Cline

Add this entry to your MCP config (`~/.cursor/mcp.json`, `.continue/config.json`, etc. — exact path depends on the client):

```json
{
  "mcpServers": {
    "tasks": {
      "command": "node",
      "args": ["/absolute/path/to/tasks-mcp/dist/mcp/server.js"]
    }
  }
}
```

### ChatGPT Desktop

In Settings → Connectors → Add local MCP server, point at the same command.

---

## Connecting non-MCP models (REST)

Run the HTTP facade:

```bash
npm run start:rest          # listens on :3939
# or pick a port:
PORT=4000 npm run start:rest
```

Smoke test:

```bash
curl http://localhost:3939/health
curl -X POST http://localhost:3939/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"refactor auth","priority":"high","labels":["backend"]}'
curl http://localhost:3939/context
```

From any LLM that supports function/tool calling, declare the endpoints (OpenAI function calling format, Gemini tools, Anthropic tool use, etc.) with URLs pointing at `localhost:3939`. See `src/rest/server.ts` for the full signature list.

---

## MCP tools

| Tool | Purpose |
|---|---|
| `get_context` | Snapshot: in-progress, blocked, next-up, due-soon. Call at the start of a session. |
| `list_tasks` | Filter by status, project, label, priority, `dueBefore`. |
| `get_task` | Full detail: subtasks, dependencies, notes, labels. |
| `create_task` | Create with title + optional `projectId`, `priority`, `labels`, `plan`, `context`, `dueAt`. |
| `update_task` | Patch mutable fields. |
| `set_status` | Transition `todo` → `doing` / `done` / `blocked` / `cancelled`. |
| `set_plan` | Persist the execution plan. |
| `add_note` | Append a note with kind `attempt` / `blocker` / `insight` / `comment`. |
| `search_tasks` | FTS5 over title + description + plan + context. |
| `add_subtask`, `list_subtasks`, `set_subtask_done`, `delete_subtask` | Checklist items. |
| `add_dependency`, `remove_dependency`, `list_dependencies` | Cycle-rejecting graph edges. |
| `list_projects`, `create_project`, `archive_project` | Grouping. |
| `list_labels`, `create_label`, `tag_task`, `untag_task` | Tagging. |
| `delete_task` | Hard delete. Prefer `set_status cancelled` unless you really want history gone. |

---

## REST endpoints

```
GET    /health
GET    /context
GET    /tasks                   ?status=&projectId=&label=&priority=&dueBefore=
GET    /tasks/:id
POST   /tasks
PATCH  /tasks/:id
POST   /tasks/:id/status        { status, reason? }
PUT    /tasks/:id/plan          { plan }
POST   /tasks/:id/notes         { body, kind }
DELETE /tasks/:id
GET    /search?q=...

POST   /tasks/:taskId/subtasks  { title }
GET    /tasks/:taskId/subtasks
PATCH  /subtasks/:id            { done }
DELETE /subtasks/:id

POST   /tasks/:taskId/dependencies            { dependsOnTaskId }
DELETE /tasks/:taskId/dependencies/:depId
GET    /tasks/:taskId/dependencies

GET    /projects                ?includeArchived=true
POST   /projects
POST   /projects/:id/archive

GET    /labels
POST   /labels
POST   /tasks/:taskId/labels/:label
DELETE /tasks/:taskId/labels/:label
```

Validation is done via Zod on both the MCP and REST layers — invalid inputs return descriptive errors.

---

## Recommended agent workflow

1. At session start → `get_context`.
2. Before creating anything → `search_tasks` to avoid duplicates.
3. When picking up work → `set_status` to `doing`, then `set_plan` with the approach.
4. As work progresses → `add_note` with kind `attempt`, `insight`, or `blocker` so the next session has history.
5. On completion → close subtasks, then `set_status` to `done`.

Pin these instructions in your project's agent config (e.g., a `CLAUDE.md`, `.cursor/rules`, or system prompt) so the agent consistently uses the store.

---

## Development

```bash
npm run dev:mcp           # stdio MCP, for MCP Inspector or piping
npm run dev:rest          # Hono dev server, auto-reloads
npm run build             # tsc to dist/
npm test                  # vitest
npm run db:generate       # drizzle-kit migrations (optional; schema auto-applies on open)
```

Project layout:

```
src/
├── core/          # domain logic — the only layer that touches SQLite
│   ├── schema.ts      drizzle table defs
│   ├── migrate.ts     embedded DDL (auto-applied on open)
│   ├── db.ts          connection + WAL + foreign keys on
│   ├── types.ts       Zod schemas, shared between facades
│   ├── tasks.ts       tasks CRUD, status transitions, FTS
│   ├── projects.ts
│   ├── labels.ts
│   ├── subtasks.ts
│   ├── dependencies.ts
│   └── context.ts     get_context summary
├── mcp/
│   └── server.ts      stdio MCP facade
└── rest/
    └── server.ts      Hono HTTP facade
```

---

## Tech stack

TypeScript (ESM) · Node ≥ 20 · `better-sqlite3` · `drizzle-orm` · `@modelcontextprotocol/sdk` · `hono` · `zod` · `vitest`.

---

## Scope / limitations

- **Single user, local-first.** There is no auth on the REST server. Bind it to localhost or put a bearer-token middleware in front before exposing it.
- **No multi-device sync.** If you need that, the core module is the only layer touching the DB — swap `better-sqlite3` for `postgres`/`libsql` without touching the facades.
- **No web UI or CLI yet.** Both can be built on top of `src/core/` without changes to the backend.

---

## License

MIT
