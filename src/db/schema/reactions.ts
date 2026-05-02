import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { messages } from "./messages.ts";

/**
 * One row per (message, emoji) pair — Discord aggregates reaction counts
 * per emoji, not per user, in the message payload. We use a composite
 * primary key keyed off the message + the emoji identity (snowflake for
 * custom emoji, fallback to the unicode glyph name).
 */
export const reactions = pgTable(
  "reactions",
  {
    messageId: snowflake("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    emojiKey: text("emoji_key").notNull(),
    emojiId: snowflake("emoji_id"),
    emojiName: text("emoji_name"),
    animated: boolean("animated").notNull().default(false),
    count: integer("count").notNull().default(0),
    burstCount: integer("burst_count").notNull().default(0),
    me: boolean("me").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.emojiKey] }),
    index("reactions_message_idx").on(table.messageId),
  ],
);

export const reactionsRelations = relations(reactions, ({ one }) => ({
  message: one(messages, {
    fields: [reactions.messageId],
    references: [messages.id],
  }),
}));

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;
