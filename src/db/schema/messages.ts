import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { attachments } from "./attachments.ts";
import { channels } from "./channels.ts";
import { reactions } from "./reactions.ts";
import { threads } from "./threads.ts";
import { users } from "./users.ts";

/**
 * A message. Every message belongs to a channel; it additionally
 * belongs to a thread when the channel is a forum/media or when the
 * message lives inside a thread spawned from a text channel.
 */
export const messages = pgTable(
  "messages",
  {
    id: snowflake("id").primaryKey(),
    channelId: snowflake("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    threadId: snowflake("thread_id").references(() => threads.id, {
      onDelete: "cascade",
    }),
    authorId: snowflake("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull().default(""),
    type: integer("type").notNull(),
    flags: integer("flags").notNull().default(0),
    pinned: boolean("pinned").notNull().default(false),
    tts: boolean("tts").notNull().default(false),
    mentionEveryone: boolean("mention_everyone").notNull().default(false),
    referencedMessageId: snowflake("referenced_message_id"),
    referencedChannelId: snowflake("referenced_channel_id"),
    referencedGuildId: snowflake("referenced_guild_id"),
    /**
     * Discord MessageReferenceType: 0 = reply (DEFAULT), 1 = FORWARD.
     * Null when the message is not a reply or forward.
     */
    referenceType: integer("reference_type"),
    /**
     * Snapshot of the source message when this message is a forward
     * (`HAS_SNAPSHOT` flag, bit 14). Each entry mirrors a Discord
     * `MessageSnapshot` object.
     */
    messageSnapshots: jsonb("message_snapshots").$type<unknown[]>().notNull().default([]),
    webhookId: snowflake("webhook_id"),
    applicationId: snowflake("application_id"),
    embeds: jsonb("embeds").$type<unknown[]>().notNull().default([]),
    mentionedUserIds: jsonb("mentioned_user_ids").$type<string[]>().notNull().default([]),
    mentionedRoleIds: jsonb("mentioned_role_ids").$type<string[]>().notNull().default([]),
    stickers: jsonb("stickers").$type<unknown[]>().notNull().default([]),
    components: jsonb("components").$type<unknown[]>().notNull().default([]),
    rawPayload: jsonb("raw_payload").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_channel_idx").on(table.channelId),
    index("messages_thread_idx").on(table.threadId),
    index("messages_author_idx").on(table.authorId),
    index("messages_created_idx").on(table.createdAt),
  ],
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  thread: one(threads, {
    fields: [messages.threadId],
    references: [threads.id],
  }),
  author: one(users, {
    fields: [messages.authorId],
    references: [users.id],
  }),
  attachments: many(attachments),
  reactions: many(reactions),
}));

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
