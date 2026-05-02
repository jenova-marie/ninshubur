import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";

/**
 * Per-scope scrape cursor.
 *
 * `scope_id` is a snowflake that points at either a `channels.id`
 * (for direct text-channel scraping) or a `threads.id` (for forum
 * post / thread scraping). After a successful pass we record the most
 * recently observed message id so incremental backfills can resume
 * without re-fetching.
 */
export const scrapeState = pgTable("scrape_state", {
  scopeId: snowflake("scope_id").primaryKey(),
  scopeType: text("scope_type").notNull(),
  lastMessageId: snowflake("last_message_id"),
  lastFullScrapeAt: timestamp("last_full_scrape_at", { withTimezone: true }),
  lastIncrementalScrapeAt: timestamp("last_incremental_scrape_at", {
    withTimezone: true,
  }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScrapeState = typeof scrapeState.$inferSelect;
export type NewScrapeState = typeof scrapeState.$inferInsert;
