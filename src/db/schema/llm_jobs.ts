import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Per-run record of an analysis phase invocation. Used by
 * `pnpm cli analyze status` to surface what's been done and how long it
 * took, plus to capture errors and parameter sets across runs.
 */
export const llmJobs = pgTable(
  "llm_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** "taxonomy" | "tag" | "group" | "embed" */
    kind: text("kind").notNull(),
    /** "running" | "completed" | "failed" | "cancelled" */
    status: text("status").notNull().default("running"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("llm_jobs_kind_started_idx").on(table.kind, table.startedAt),
    index("llm_jobs_status_idx").on(table.status),
  ],
);

export type LlmJob = typeof llmJobs.$inferSelect;
export type NewLlmJob = typeof llmJobs.$inferInsert;
