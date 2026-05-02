import { relations } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { channels } from "./channels.ts";

export const guilds = pgTable("guilds", {
  id: snowflake("id").primaryKey(),
  name: text("name").notNull(),
  iconHash: text("icon_hash"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const guildsRelations = relations(guilds, ({ many }) => ({
  channels: many(channels),
}));

export type Guild = typeof guilds.$inferSelect;
export type NewGuild = typeof guilds.$inferInsert;
