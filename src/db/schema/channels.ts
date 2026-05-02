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
import { guilds } from "./guilds.ts";
import { forumTags } from "./tags.ts";
import { messages } from "./messages.ts";
import { threads } from "./threads.ts";

/**
 * Any channel we're aware of in a tracked guild. The `type` column
 * holds the discord.js `ChannelType` enum value (text, forum, voice
 * with text, etc.). Forum/Media-only fields are populated for those
 * channel types and remain null for text-like channels.
 */
export const channels = pgTable(
  "channels",
  {
    id: snowflake("id").primaryKey(),
    guildId: snowflake("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    type: integer("type").notNull(),
    name: text("name").notNull(),
    topic: text("topic"),
    parentId: snowflake("parent_id"),
    position: integer("position"),
    nsfw: boolean("nsfw").notNull().default(false),
    rateLimitPerUser: integer("rate_limit_per_user"),
    lastMessageId: snowflake("last_message_id"),
    // Forum / media-only fields (null for text-like channels)
    defaultAutoArchiveDuration: integer("default_auto_archive_duration"),
    defaultThreadRateLimitPerUser: integer("default_thread_rate_limit_per_user"),
    defaultSortOrder: integer("default_sort_order"),
    defaultForumLayout: integer("default_forum_layout"),
    defaultReactionEmoji: jsonb("default_reaction_emoji").$type<{
      emojiId: string | null;
      emojiName: string | null;
    } | null>(),
    flags: integer("flags").notNull().default(0),
    isTracked: boolean("is_tracked").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("channels_guild_idx").on(table.guildId),
    index("channels_type_idx").on(table.type),
  ],
);

export const channelsRelations = relations(channels, ({ one, many }) => ({
  guild: one(guilds, {
    fields: [channels.guildId],
    references: [guilds.id],
  }),
  tags: many(forumTags),
  threads: many(threads),
  messages: many(messages),
}));

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
