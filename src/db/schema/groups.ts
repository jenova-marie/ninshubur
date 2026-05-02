import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { channels } from "./channels.ts";
import { messages } from "./messages.ts";
import { threads } from "./threads.ts";

/**
 * A semantic grouping of consecutive messages — the natural RAG chunk
 * for "this is one lesson / one greeting exchange / one digression."
 *
 * Built by `pnpm cli analyze group`, which slides a window of N
 * consecutive messages past Haiku and asks for breakpoints.
 */
export const messageGroups = pgTable(
  "message_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: snowflake("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    threadId: snowflake("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    summary: text("summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").notNull().default(0),
    /** "haiku@4.5" | "manual" */
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("message_groups_channel_idx").on(table.channelId),
    index("message_groups_thread_idx").on(table.threadId),
    index("message_groups_started_idx").on(table.startedAt),
  ],
);

export const messageGroupsRelations = relations(messageGroups, ({ one, many }) => ({
  channel: one(channels, {
    fields: [messageGroups.channelId],
    references: [channels.id],
  }),
  thread: one(threads, {
    fields: [messageGroups.threadId],
    references: [threads.id],
  }),
  members: many(messageGroupMembers),
}));

/**
 * Ordered membership of messages within a group.
 * `position` is 0-based, matches chronological order at grouping time.
 */
export const messageGroupMembers = pgTable(
  "message_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => messageGroups.id, { onDelete: "cascade" }),
    messageId: snowflake("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.messageId] }),
    index("message_group_members_message_idx").on(table.messageId),
  ],
);

export const messageGroupMembersRelations = relations(messageGroupMembers, ({ one }) => ({
  group: one(messageGroups, {
    fields: [messageGroupMembers.groupId],
    references: [messageGroups.id],
  }),
  message: one(messages, {
    fields: [messageGroupMembers.messageId],
    references: [messages.id],
  }),
}));

export type MessageGroup = typeof messageGroups.$inferSelect;
export type NewMessageGroup = typeof messageGroups.$inferInsert;
export type MessageGroupMember = typeof messageGroupMembers.$inferSelect;
export type NewMessageGroupMember = typeof messageGroupMembers.$inferInsert;
