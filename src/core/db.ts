import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema.js";
import { applyMigrations } from "./migrate.js";

export type DB = BetterSQLite3Database<typeof schema>;

let cached: { db: DB; raw: Database.Database } | null = null;

export function openDb(path?: string): { db: DB; raw: Database.Database } {
  if (cached) return cached;
  const dbPath =
    path ??
    process.env.TASKS_DB_PATH ??
    resolve(process.cwd(), "data", "tasks.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const raw = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  const db = drizzle(raw, { schema });
  applyMigrations(raw);
  cached = { db, raw };
  return cached;
}

export function closeDb(): void {
  if (cached) {
    cached.raw.close();
    cached = null;
  }
}

export { schema };
