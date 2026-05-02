import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { channels } from "./channels.ts";
import { messages } from "./messages.ts";
import { threadAppliedTags } from "./tags.ts";
import { users } from "./users.ts";

/**
 * A thread. In Discord this is one of `PublicThreadChannel`,
 * `PrivateThreadChannel`, or `AnnouncementThreadChannel`. Threads can
 * live under forum channels (each post is a thread) or under text /
 * announcement channels (a thread spawned from a message).
 */
export const threads = pgTable(
  "threads",
  {
    id: snowflake("id").primaryKey(),
    channelId: snowflake("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    ownerId: snowflake("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    archived: boolean("archived").notNull().default(false),
    locked: boolean("locked").notNull().default(false),
    invitable: boolean("invitable"),
    autoArchiveDuration: integer("auto_archive_duration"),
    rateLimitPerUser: integer("rate_limit_per_user"),
    messageCount: integer("message_count").notNull().default(0),
    totalMessageSent: integer("total_message_sent").notNull().default(0),
    memberCount: integer("member_count").notNull().default(0),
    flags: integer("flags").notNull().default(0),
    type: integer("type").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastMessageId: snowflake("last_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("threads_channel_idx").on(table.channelId),
    index("threads_owner_idx").on(table.ownerId),
    index("threads_archived_idx").on(table.archived),
  ],
);

export const threadsRelations = relations(threads, ({ one, many }) => ({
  channel: one(channels, {
    fields: [threads.channelId],
    references: [channels.id],
  }),
  owner: one(users, {
    fields: [threads.ownerId],
    references: [users.id],
  }),
  appliedTags: many(threadAppliedTags),
  messages: many(messages),
}));

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
