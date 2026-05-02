import { relations } from "drizzle-orm";
import { boolean, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { channels } from "./channels.ts";
import { threads } from "./threads.ts";

/**
 * Tags configured on a forum (or media) channel. Mirrors
 * `GuildForumTag` from discord.js.
 */
export const forumTags = pgTable("forum_tags", {
  id: snowflake("id").primaryKey(),
  channelId: snowflake("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  moderated: boolean("moderated").notNull().default(false),
  emojiId: snowflake("emoji_id"),
  emojiName: text("emoji_name"),
});

export const forumTagsRelations = relations(forumTags, ({ one, many }) => ({
  channel: one(channels, {
    fields: [forumTags.channelId],
    references: [channels.id],
  }),
  threadAppliedTags: many(threadAppliedTags),
}));

/**
 * Many-to-many between threads (forum posts) and the tags applied to them.
 */
export const threadAppliedTags = pgTable(
  "thread_applied_tags",
  {
    threadId: snowflake("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    tagId: snowflake("tag_id")
      .notNull()
      .references(() => forumTags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.tagId] })],
);

export const threadAppliedTagsRelations = relations(threadAppliedTags, ({ one }) => ({
  thread: one(threads, {
    fields: [threadAppliedTags.threadId],
    references: [threads.id],
  }),
  tag: one(forumTags, {
    fields: [threadAppliedTags.tagId],
    references: [forumTags.id],
  }),
}));

export type ForumTag = typeof forumTags.$inferSelect;
export type NewForumTag = typeof forumTags.$inferInsert;
export type ThreadAppliedTag = typeof threadAppliedTags.$inferSelect;
export type NewThreadAppliedTag = typeof threadAppliedTags.$inferInsert;
