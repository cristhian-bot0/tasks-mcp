import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applyMigrations } from "../src/core/migrate.js";
import * as schema from "../src/core/schema.js";
import type { DB } from "../src/core/db.js";

export function createTestDb(): { db: DB; raw: Database.Database } {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyMigrations(raw);
  const db = drizzle(raw, { schema });
  return { db, raw };
}
