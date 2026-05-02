import { relations, sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { snowflake } from "./_columns.ts";
import { messages } from "./messages.ts";

/**
 * LLM-derived semantic categories ("greeting", "lesson", "personality", …).
 * Distinct from `forum_tags`, which mirror Discord's per-channel tag system.
 *
 * The taxonomy is built in two passes by `pnpm cli analyze taxonomy`:
 * Haiku proposes candidates, then a curation pass merges synonyms. The
 * resulting set is locked and used by the per-message tagging phase.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** "haiku@4.5" | "manual" | "seed" */
    source: text("source").notNull().default("haiku"),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("categories_slug_idx").on(table.slug),
  ],
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  messageCategories: many(messageCategories),
}));

/**
 * M2M: per-message assignments of categories with confidence + provenance.
 */
export const messageCategories = pgTable(
  "message_categories",
  {
    messageId: snowflake("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    confidence: real("confidence"),
    /** "haiku@4.5" | "manual" */
    source: text("source").notNull().default("haiku"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.categoryId] }),
    index("message_categories_category_idx").on(table.categoryId),
  ],
);

export const messageCategoriesRelations = relations(messageCategories, ({ one }) => ({
  message: one(messages, {
    fields: [messageCategories.messageId],
    references: [messages.id],
  }),
  category: one(categories, {
    fields: [messageCategories.categoryId],
    references: [categories.id],
  }),
}));

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type MessageCategory = typeof messageCategories.$inferSelect;
export type NewMessageCategory = typeof messageCategories.$inferInsert;

// `sql` is imported for downstream where-clause helpers; the no-op export
// keeps tree-shakers happy in case a consumer destructures it.
export const _categoriesSql = sql;
