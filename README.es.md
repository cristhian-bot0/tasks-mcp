# tasks-mcp

**Idioma:** [English](README.md) · **Español**

Un backend local de gestión de tareas construido **para que los LLMs lo usen como memoria persistente**.

A diferencia de Trello, Linear o Plane — optimizados para equipos humanos — `tasks-mcp` trata los planes de ejecución, el registro de intentos y el contexto de razonamiento como campos de primera clase. Expone dos fachadas sobre una única base SQLite:

- **Servidor MCP (stdio)** — para cualquier agente compatible con MCP (Claude Code, Cursor, Windsurf, Continue.dev, Cline, ChatGPT desktop, etc.).
- **API REST (HTTP + JSON)** — para modelos que solo hablan function calling (Gemini, Llama, Mistral, o tu propio código).

Ambas fachadas leen y escriben la misma base, así que las tareas creadas por un agente son inmediatamente visibles para otro.

---

## ¿Por qué no usar Linear/Plane/Trello?

Esos sistemas modelan un *flujo humano*: asignado, sprint, columna de estado, comentarios. Este proyecto modela un *flujo de agente*:

| Campo | Propósito |
|---|---|
| `plan` | El enfoque que el agente intenta tomar antes de empezar |
| `context` | Por qué la tarea importa, restricciones, referencias |
| `notes` con `kind` | Entradas de log por tarea tipadas como `attempt`, `blocker`, `insight` o `comment` |
| Máquina de estados `status` | Transiciones claras con efectos secundarios (`startedAt`, `completedAt`, `blockedReason`) |
| Filtros ricos | Estado, proyecto, etiqueta, prioridad, fecha — pensados para consultas one-shot del LLM |

Una conversación con un LLM es efímera. Esta base de datos no. En la próxima sesión, el agente llama `get_context` y retoma el trabajo donde se detuvo.

---

## Características

- **Modelo de tareas rico**: proyectos, prioridades (`low`/`med`/`high`/`urgent`), etiquetas, subtareas, dependencias (con detección de ciclos), fechas de vencimiento.
- **Campos específicos para LLMs**: `plan`, `context`, notas tipadas.
- **Búsqueda full-text** sobre título, descripción, plan y contexto (SQLite FTS5).
- **Un único archivo SQLite** — sin servicios, sin contenedores, sin servidor de sincronización.
- **Dos fachadas**, un core: 25+ herramientas MCP y una superficie REST paralela.
- **Type-safe**: TypeScript + Drizzle + esquemas Zod compartidos entre ambas fachadas.

---

## Instalación

Requisitos: Node.js ≥ 20, npm.

```bash
git clone https://github.com/<tu-usuario>/tasks-mcp.git
cd tasks-mcp
npm install
npm run build
npm test          # 18 tests unitarios
```

El archivo SQLite se crea automáticamente en `./data/tasks.db` al arrancar. Cambia la ruta con `TASKS_DB_PATH=/ruta/absoluta/tasks.db`.

---

## Conectar con clientes MCP

### Claude Code

```bash
claude mcp add --scope user tasks \
  node /ruta/absoluta/a/tasks-mcp/dist/mcp/server.js
```

`--scope user` hace que el servidor esté disponible en cualquier directorio de trabajo. Verifica:

```bash
claude mcp list | grep tasks
# tasks: node /.../dist/mcp/server.js - ✓ Connected
```

### Cursor / Windsurf / Continue.dev / Cline

Agrega esta entrada a tu config de MCP (`~/.cursor/mcp.json`, `.continue/config.json`, etc. — la ruta exacta depende del cliente):

```json
{
  "mcpServers": {
    "tasks": {
      "command": "node",
      "args": ["/ruta/absoluta/a/tasks-mcp/dist/mcp/server.js"]
    }
  }
}
```

### ChatGPT Desktop

En Ajustes → Conectores → Añadir servidor MCP local, apunta al mismo comando.

---

## Conectar modelos no-MCP (REST)

Arranca la fachada HTTP:

```bash
npm run start:rest          # escucha en :3939
# o elige otro puerto:
PORT=4000 npm run start:rest
```

Prueba rápida:

```bash
curl http://localhost:3939/health
curl -X POST http://localhost:3939/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"refactor auth","priority":"high","labels":["backend"]}'
curl http://localhost:3939/context
```

Desde cualquier LLM que soporte function/tool calling, declara los endpoints (formato de OpenAI, Gemini tools, Anthropic tool use, etc.) apuntando a `localhost:3939`. Ver `src/rest/server.ts` para la lista completa de firmas.

---

## Herramientas MCP

| Herramienta | Propósito |
|---|---|
| `get_context` | Resumen: en progreso, bloqueadas, próximas, vencen pronto. Llámala al inicio de la sesión. |
| `list_tasks` | Filtra por estado, proyecto, etiqueta, prioridad, `dueBefore`. |
| `get_task` | Detalle completo: subtareas, dependencias, notas, etiquetas. |
| `create_task` | Crea con título + opcional `projectId`, `priority`, `labels`, `plan`, `context`, `dueAt`. |
| `update_task` | Actualiza campos mutables. |
| `set_status` | Transiciona `todo` → `doing` / `done` / `blocked` / `cancelled`. |
| `set_plan` | Persiste el plan de ejecución. |
| `add_note` | Añade nota con kind `attempt` / `blocker` / `insight` / `comment`. |
| `search_tasks` | FTS5 sobre título + descripción + plan + contexto. |
| `add_subtask`, `list_subtasks`, `set_subtask_done`, `delete_subtask` | Ítems de checklist. |
| `add_dependency`, `remove_dependency`, `list_dependencies` | Grafos con rechazo de ciclos. |
| `list_projects`, `create_project`, `archive_project` | Agrupación. |
| `list_labels`, `create_label`, `tag_task`, `untag_task` | Etiquetado. |
| `delete_task` | Borrado duro. Prefiere `set_status cancelled` salvo que quieras borrar historial. |

---

## Endpoints REST

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

La validación se hace con Zod tanto en la capa MCP como en la REST — las entradas inválidas devuelven errores descriptivos.

---

## Flujo de trabajo recomendado para el agente

1. Al inicio de la sesión → `get_context`.
2. Antes de crear algo → `search_tasks` para evitar duplicados.
3. Al retomar trabajo → `set_status` a `doing`, luego `set_plan` con el enfoque.
4. Mientras trabaja → `add_note` con kind `attempt`, `insight` o `blocker` para que la próxima sesión tenga historial.
5. Al terminar → cierra las subtareas, luego `set_status` a `done`.

Fija estas instrucciones en la configuración de agente de tu proyecto (un `CLAUDE.md`, `.cursor/rules` o system prompt) para que el agente use el store de forma consistente.

---

## Desarrollo

```bash
npm run dev:mcp           # MCP stdio, para MCP Inspector o piping
npm run dev:rest          # servidor Hono con auto-reload
npm run build             # tsc a dist/
npm test                  # vitest
npm run db:generate       # migraciones drizzle-kit (opcional; el esquema se auto-aplica)
```

Estructura:

```
src/
├── core/          # lógica de dominio — la única capa que toca SQLite
│   ├── schema.ts      tablas drizzle
│   ├── migrate.ts     DDL embebido (se aplica al abrir)
│   ├── db.ts          conexión + WAL + foreign keys activas
│   ├── types.ts       esquemas Zod compartidos entre fachadas
│   ├── tasks.ts       CRUD, transiciones de estado, FTS
│   ├── projects.ts
│   ├── labels.ts
│   ├── subtasks.ts
│   ├── dependencies.ts
│   └── context.ts     resumen get_context
├── mcp/
│   └── server.ts      fachada MCP stdio
└── rest/
    └── server.ts      fachada HTTP Hono
```

---

## Stack

TypeScript (ESM) · Node ≥ 20 · `better-sqlite3` · `drizzle-orm` · `@modelcontextprotocol/sdk` · `hono` · `zod` · `vitest`.

---

## Alcance / limitaciones

- **Un solo usuario, local-first.** No hay auth en el servidor REST. Enlázalo solo a localhost o pon un middleware de bearer-token antes de exponerlo.
- **Sin sincronización multi-dispositivo.** Si la necesitas, el módulo core es la única capa que toca la DB — cambia `better-sqlite3` por `postgres`/`libsql` sin tocar las fachadas.
- **Sin UI web ni CLI todavía.** Ambas se pueden construir sobre `src/core/` sin cambios en el backend.

---

## Licencia

MIT
