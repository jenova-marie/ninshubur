import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { messages } from "./messages.ts";

export const attachments = pgTable(
  "attachments",
  {
    id: snowflake("id").primaryKey(),
    messageId: snowflake("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    title: text("title"),
    description: text("description"),
    contentType: text("content_type"),
    size: bigint("size", { mode: "number" }).notNull(),
    url: text("url").notNull(),
    proxyUrl: text("proxy_url").notNull(),
    width: integer("width"),
    height: integer("height"),
    /**
     * Voice-message duration in seconds. Discord ships this as a
     * float (e.g. 25.45...) so we store double precision rather than
     * integer.
     */
    durationSecs: doublePrecision("duration_secs"),
    waveform: text("waveform"),
    ephemeral: boolean("ephemeral").notNull().default(false),
    flags: integer("flags").notNull().default(0),
  },
  (table) => [index("attachments_message_idx").on(table.messageId)],
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  message: one(messages, {
    fields: [attachments.messageId],
    references: [messages.id],
  }),
}));

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
