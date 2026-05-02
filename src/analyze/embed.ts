import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  embeddings as embeddingsTable,
  type NewEmbedding,
} from "../db/schema/index.ts";
import { env } from "../config.ts";
import { logger } from "../logger.ts";
import { embed } from "../llm/voyage.ts";
import { ensureCollection, snowflakeToPointId, upsertPoints } from "../llm/qdrant.ts";
import { withJob } from "./job.ts";

export type EmbedScope = "all" | "messages" | "groups";

export interface EmbedOptions {
  scope?: EmbedScope;
  /** Cap rows per scope for debugging. */
  limit?: number;
  /** Re-embed every row in scope, ignoring existing `embeddings` rows. */
  force?: boolean;
}

interface MessageRow {
  id: string;
  channel_id: string;
  thread_id: string | null;
  author_id: string | null;
  // node-postgres returns timestamps as Date; raw `db.execute(sql)` may
  // return them as ISO strings. We accept either and normalise below.
  created_at: Date | string;
  text: string;
  category_slugs: string[];
  group_id: string | null;
}

interface GroupRow {
  id: string;
  channel_id: string;
  thread_id: string | null;
  summary: string | null;
  started_at: Date | string;
  ended_at: Date | string;
  message_count: number;
  text: string;
  category_slugs: string[];
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  // Already a string — assume ISO-ish and pass through unchanged.
  return String(value);
}

async function loadMessagesNeedingEmbedding(
  model: string,
  limit: number,
  force: boolean,
): Promise<MessageRow[]> {
  // When --force, skip the "already embedded" filter so every message
  // is re-embedded. The upsert in embedMessageBatch handles the
  // unique-constraint conflict.
  const skipFilter = force
    ? sql``
    : sql`AND NOT EXISTS (
        SELECT 1 FROM embeddings e
        WHERE e.scope_type = 'message'
          AND e.scope_id = m.id::text
          AND e.model = ${model}
      )`;

  const result = await db.execute(
    sql`
      SELECT m.id::text AS id,
             m.channel_id::text AS channel_id,
             m.thread_id::text AS thread_id,
             m.author_id::text AS author_id,
             m.created_at AS created_at,
             COALESCE(NULLIF(m.content, ''),
                      m.message_snapshots->0->>'content',
                      '') AS text,
             COALESCE(
               (SELECT array_agg(c.slug ORDER BY c.slug)
                FROM message_categories mc
                JOIN categories c ON c.id = mc.category_id
                WHERE mc.message_id = m.id),
               ARRAY[]::text[]
             ) AS category_slugs,
             (SELECT mgm.group_id::text
              FROM message_group_members mgm
              WHERE mgm.message_id = m.id
              LIMIT 1) AS group_id
      FROM messages m
      WHERE COALESCE(NULLIF(m.content, ''),
                     m.message_snapshots->0->>'content', '') <> ''
      ${skipFilter}
      ORDER BY m.created_at
      LIMIT ${limit}
    `,
  );
  return result.rows as unknown as MessageRow[];
}

async function loadGroupsNeedingEmbedding(
  model: string,
  limit: number,
  force: boolean,
): Promise<GroupRow[]> {
  const skipFilter = force
    ? sql``
    : sql`WHERE NOT EXISTS (
        SELECT 1 FROM embeddings e
        WHERE e.scope_type = 'group'
          AND e.scope_id = g.id::text
          AND e.model = ${model}
      )`;

  // The embedded `text` for each group is the Haiku-generated summary
  // PLUS the concatenated message bodies. Prepending the summary
  // anchors the vector toward the meaningful description ("Overview
  // of Ishtaritism religion…") rather than just the raw words said
  // in chat — which dramatically improves RAG retrieval quality on
  // questions whose phrasing matches the *concept* better than any
  // single message.
  const result = await db.execute(
    sql`
      SELECT g.id::text AS id,
             g.channel_id::text AS channel_id,
             g.thread_id::text AS thread_id,
             g.summary,
             g.started_at,
             g.ended_at,
             g.message_count,
             (
               'Summary: ' || COALESCE(g.summary, '(no summary)')
               || E'\n\n'
               || COALESCE(
                    (SELECT string_agg(
                       CONCAT(COALESCE(u.username, 'unknown'), ': ',
                              COALESCE(NULLIF(m.content, ''),
                                       m.message_snapshots->0->>'content', '')),
                       E'\n'
                       ORDER BY mgm.position
                     )
                     FROM message_group_members mgm
                     JOIN messages m ON m.id = mgm.message_id
                     LEFT JOIN users u ON u.id = m.author_id
                     WHERE mgm.group_id = g.id),
                    ''
                  )
             ) AS text,
             COALESCE(
               (SELECT array_agg(DISTINCT c.slug ORDER BY c.slug)
                FROM message_group_members mgm
                JOIN message_categories mc ON mc.message_id = mgm.message_id
                JOIN categories c ON c.id = mc.category_id
                WHERE mgm.group_id = g.id),
               ARRAY[]::text[]
             ) AS category_slugs
      FROM message_groups g
      ${skipFilter}
      ORDER BY g.started_at
      LIMIT ${limit}
    `,
  );
  return result.rows as unknown as GroupRow[];
}

interface EmbedRunStats {
  scope: "messages" | "groups";
  embedded: number;
  totalTokens: number;
}

async function embedMessageBatch(
  rows: MessageRow[],
  collection: string,
): Promise<EmbedRunStats> {
  if (rows.length === 0) {
    return { scope: "messages", embedded: 0, totalTokens: 0 };
  }
  await ensureCollection(collection, 1024); // voyage-3.5 → 1024 dims

  const texts = rows.map((r) => r.text);
  const result = await embed({ texts, inputType: "document" });
  if (result.dim === 0) throw new Error("voyage returned 0-dim vectors");
  await ensureCollection(collection, result.dim);

  const points = rows.map((row, idx) => {
    const pointId = snowflakeToPointId(row.id);
    return {
      id: pointId,
      vector: result.vectors[idx] ?? [],
      payload: {
        scope_type: "message" as const,
        scope_id: row.id, // original snowflake — for reverse lookup from search hits
        channel_id: row.channel_id,
        thread_id: row.thread_id,
        author_id: row.author_id,
        created_at: toIso(row.created_at),
        group_id: row.group_id,
        category_slugs: row.category_slugs,
        text: row.text.slice(0, 2000),
      },
    };
  });
  await upsertPoints(collection, points);

  const bookkeeping: NewEmbedding[] = rows.map((row) => ({
    scopeType: "message",
    scopeId: row.id,
    model: result.model,
    dim: result.dim,
    qdrantPointId: snowflakeToPointId(row.id),
    qdrantCollection: collection,
    payloadHash: sha256(row.text),
    updatedAt: new Date(),
  }));
  await db
    .insert(embeddingsTable)
    .values(bookkeeping)
    .onConflictDoUpdate({
      target: [embeddingsTable.scopeType, embeddingsTable.scopeId, embeddingsTable.model],
      set: {
        qdrantPointId: sql`excluded.qdrant_point_id`,
        qdrantCollection: sql`excluded.qdrant_collection`,
        payloadHash: sql`excluded.payload_hash`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  return { scope: "messages", embedded: rows.length, totalTokens: result.totalTokens };
}

async function embedGroupBatch(
  rows: GroupRow[],
  collection: string,
): Promise<EmbedRunStats> {
  if (rows.length === 0) {
    return { scope: "groups", embedded: 0, totalTokens: 0 };
  }

  const texts = rows.map((r) => r.text ?? r.summary ?? "");
  const result = await embed({ texts, inputType: "document" });
  if (result.dim === 0) throw new Error("voyage returned 0-dim vectors");
  await ensureCollection(collection, result.dim);

  const points = rows.map((row, idx) => ({
    id: row.id, // group ids are already UUIDs (Drizzle defaultRandom)
    vector: result.vectors[idx] ?? [],
    payload: {
      scope_type: "group" as const,
      scope_id: row.id,
      channel_id: row.channel_id,
      thread_id: row.thread_id,
      summary: row.summary,
      started_at: toIso(row.started_at),
      ended_at: toIso(row.ended_at),
      message_count: row.message_count,
      category_slugs: row.category_slugs,
    },
  }));
  await upsertPoints(collection, points);

  const bookkeeping: NewEmbedding[] = rows.map((row) => ({
    scopeType: "group",
    scopeId: row.id,
    model: result.model,
    dim: result.dim,
    qdrantPointId: row.id,
    qdrantCollection: collection,
    payloadHash: sha256(row.text ?? row.summary ?? ""),
    updatedAt: new Date(),
  }));
  await db
    .insert(embeddingsTable)
    .values(bookkeeping)
    .onConflictDoUpdate({
      target: [embeddingsTable.scopeType, embeddingsTable.scopeId, embeddingsTable.model],
      set: {
        qdrantPointId: sql`excluded.qdrant_point_id`,
        qdrantCollection: sql`excluded.qdrant_collection`,
        payloadHash: sql`excluded.payload_hash`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  return { scope: "groups", embedded: rows.length, totalTokens: result.totalTokens };
}

export async function runEmbed(opts: EmbedOptions = {}): Promise<void> {
  const scope = opts.scope ?? "all";
  const limit = opts.limit ?? 10_000;
  const force = opts.force ?? false;

  await withJob("embed", { scope, limit, force }, async () => {
    const stats: EmbedRunStats[] = [];

    // Eagerly ensure both collections exist before any embedding work.
    // This prevents `rag query` from 404ing when one of the scopes had
    // no rows to embed (e.g. Phase C hasn't run yet, or produced 0
    // groups). voyage-3.5 → 1024 dims, Cosine.
    if (scope === "all" || scope === "messages") {
      await ensureCollection(env.QDRANT_COLLECTION_MESSAGES, 1024);
    }
    if (scope === "all" || scope === "groups") {
      await ensureCollection(env.QDRANT_COLLECTION_GROUPS, 1024);
    }

    if (scope === "all" || scope === "messages") {
      const rows = await loadMessagesNeedingEmbedding(env.VOYAGE_MODEL, limit, force);
      logger.info({ count: rows.length, force }, "embedding messages");
      // Voyage limits each request to 128 inputs; voyage.embed handles
      // chunking, but we still cap the total batch size to keep memory
      // pressure sane on huge corpora.
      for (let i = 0; i < rows.length; i += 256) {
        const slice = rows.slice(i, i + 256);
        stats.push(await embedMessageBatch(slice, env.QDRANT_COLLECTION_MESSAGES));
      }
    }

    if (scope === "all" || scope === "groups") {
      const rows = await loadGroupsNeedingEmbedding(env.VOYAGE_MODEL, limit, force);
      logger.info({ count: rows.length, force }, "embedding groups");
      for (let i = 0; i < rows.length; i += 256) {
        const slice = rows.slice(i, i + 256);
        stats.push(await embedGroupBatch(slice, env.QDRANT_COLLECTION_GROUPS));
      }
    }

    return {
      result: {
        scope,
        force,
        runs: stats,
        totalEmbedded: stats.reduce((acc, s) => acc + s.embedded, 0),
        totalTokens: stats.reduce((acc, s) => acc + s.totalTokens, 0),
      },
      value: undefined,
    };
  });
}
