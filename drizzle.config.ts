import type { Config } from "drizzle-kit";

export default {
  schema: "./src/core/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/tasks.db",
  },
} satisfies Config;
