import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { env } from "../config.ts";
import { embedQuery } from "../llm/voyage.ts";
import { search } from "../llm/qdrant.ts";

export interface RagQueryOptions {
  query: string;
  /** Search the message collection or the group collection. */
  scope?: "messages" | "groups";
  limit?: number;
  /** Filter to a single category slug. */
  category?: string;
  /** Filter to a single channel id. */
  channelId?: string;
}

export interface RagResult {
  scopeType: "message" | "group";
  scopeId: string;
  score: number;
  payload: Record<string, unknown>;
  hydrated: Record<string, unknown> | null;
}

function buildFilter(opts: RagQueryOptions): Record<string, unknown> | undefined {
  const must: Array<Record<string, unknown>> = [];
  if (opts.category) {
    must.push({ key: "category_slugs", match: { value: opts.category } });
  }
  if (opts.channelId) {
    must.push({ key: "channel_id", match: { value: opts.channelId } });
  }
  if (must.length === 0) return undefined;
  return { must };
}

async function hydrateMessage(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.execute(
    sql`
      SELECT m.id::text AS id,
             u.username AS author,
             m.created_at AS created_at,
             COALESCE(NULLIF(m.content, ''),
                      m.message_snapshots->0->>'content',
                      '') AS content
      FROM messages m
      LEFT JOIN users u ON u.id = m.author_id
      WHERE m.id = ${id}
      LIMIT 1
    `,
  );
  return (rows.rows[0] as Record<string, unknown>) ?? null;
}

async function hydrateGroup(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.execute(
    sql`
      SELECT g.id::text AS id, g.channel_id, g.summary, g.started_at, g.ended_at,
             g.message_count
      FROM message_groups g
      WHERE g.id = ${id}
      LIMIT 1
    `,
  );
  return (rows.rows[0] as Record<string, unknown>) ?? null;
}

export async function runRagQuery(opts: RagQueryOptions): Promise<RagResult[]> {
  const scope = opts.scope ?? "groups";
  const collection =
    scope === "groups"
      ? env.QDRANT_COLLECTION_GROUPS
      : env.QDRANT_COLLECTION_MESSAGES;

  const vector = await embedQuery(opts.query);
  const hits = await search({
    collection,
    vector,
    limit: opts.limit ?? 10,
    filter: buildFilter(opts),
    withPayload: true,
  });

  const results: RagResult[] = [];
  for (const hit of hits) {
    const payload = (hit.payload ?? {}) as Record<string, unknown>;
    // Message point ids are UUIDv5 derived from snowflakes — the
    // original Discord id is on the payload as `scope_id`. For groups
    // the point id and scope_id are the same UUID.
    const scopeId =
      typeof payload.scope_id === "string" ? payload.scope_id : String(hit.id);
    const hydrated =
      scope === "groups" ? await hydrateGroup(scopeId) : await hydrateMessage(scopeId);
    results.push({
      scopeType: scope === "groups" ? "group" : "message",
      scopeId,
      score: hit.score,
      payload,
      hydrated,
    });
  }
  return results;
}
