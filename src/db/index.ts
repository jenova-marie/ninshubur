import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config.ts";
import { logger } from "../logger.ts";
import * as schema from "./schema/index.ts";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

pool.on("error", (err) => {
  logger.error({ err }, "postgres pool error");
});

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Database = typeof db;
export { schema };
