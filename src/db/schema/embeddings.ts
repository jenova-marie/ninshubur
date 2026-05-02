import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Bookkeeping for embeddings. The actual vectors live in Qdrant; this
 * table records *what was embedded with which model* so we can:
 *   - detect drift (re-embed when the source content changes)
 *   - safely re-run the embed phase as a no-op for unchanged records
 *   - swap models without losing the audit trail
 *
 * `scope_type` is "message" or "group" — determined by the producer.
 * `scope_id` is the source row's primary key (snowflake or UUID),
 * stored as text to avoid two columns + their FK gymnastics.
 */
export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    model: text("model").notNull(),
    dim: integer("dim").notNull(),
    qdrantPointId: text("qdrant_point_id").notNull(),
    qdrantCollection: text("qdrant_collection").notNull(),
    /**
     * sha256 of the text that was embedded — lets the embed phase
     * skip re-embedding when the message/group content is unchanged.
     */
    payloadHash: text("payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("embeddings_scope_model_idx").on(
      table.scopeType,
      table.scopeId,
      table.model,
    ),
  ],
);

export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;
