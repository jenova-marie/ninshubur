import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";

/**
 * Discord users we have observed authoring messages, threads, or reactions.
 * We persist a denormalised snapshot of common profile fields so that
 * historical data remains useful even if the user later leaves.
 */
export const users = pgTable("users", {
  id: snowflake("id").primaryKey(),
  username: text("username").notNull(),
  globalName: text("global_name"),
  discriminator: text("discriminator"),
  avatarHash: text("avatar_hash"),
  bot: boolean("bot").notNull().default(false),
  system: boolean("system").notNull().default(false),
  publicFlags: integer("public_flags"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
