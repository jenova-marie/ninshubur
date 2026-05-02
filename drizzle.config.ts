import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL must be set to run drizzle-kit");
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
