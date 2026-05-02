import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  messageCategories,
  messages,
  type NewMessageCategory,
} from "../db/schema/index.ts";
import { env } from "../config.ts";
import { logger } from "../logger.ts";
import { structured } from "../llm/haiku.ts";
import { categoryIdsBySlug, loadTaxonomyMarkdown } from "./taxonomy.ts";
import { messageTagPrompt } from "../prompts/index.ts";
import { messageTagSchema, normalizeSlug } from "./schema.ts";
import { withJob } from "./job.ts";

export interface TagOptions {
  channelId?: string;
  since?: string;
  limit?: number;
}

interface TaggableMessage {
  id: string;
  content: string;
  author: string | null;
}

async function loadUntagged(opts: TagOptions): Promise<TaggableMessage[]> {
  const limit = opts.limit ?? 1000;
  const filters: string[] = [];
  if (opts.channelId) filters.push(`m.channel_id = '${opts.channelId}'`);
  if (opts.since) filters.push(`m.created_at >= '${opts.since}'`);
  const where = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

  const rows = await db.execute(
    sql.raw(`
      SELECT m.id::text AS id,
             COALESCE(NULLIF(m.content, ''),
                      m.message_snapshots->0->>'content',
                      '') AS content,
             u.username AS author
      FROM messages m
      LEFT JOIN users u ON u.id = m.author_id
      WHERE NOT EXISTS (
        SELECT 1 FROM message_categories mc WHERE mc.message_id = m.id
      )
      AND COALESCE(NULLIF(m.content, ''),
                   m.message_snapshots->0->>'content', '') <> ''
      ${where}
      ORDER BY m.created_at
      LIMIT ${limit}
    `),
  );
  return rows.rows as unknown as TaggableMessage[];
}

export async function runTag(opts: TagOptions = {}): Promise<void> {
  await withJob("tag", { ...opts }, async () => {
    const taxonomyMarkdown = await loadTaxonomyMarkdown();
    const slugToId = await categoryIdsBySlug();
    const prompt = messageTagPrompt(taxonomyMarkdown);

    const targets = await loadUntagged(opts);
    logger.info({ count: targets.length }, "tagging messages");

    let tagged = 0;
    let skippedNovel = 0;

    for (const msg of targets) {
      const userBlock = `${msg.author ?? "unknown"}: ${msg.content}`;
      try {
        const response = await structured({
          system: prompt,
          user: userBlock,
          schema: messageTagSchema,
          maxTokens: 1024,
        });

        const rows: NewMessageCategory[] = [];
        for (const cat of response.data.categories) {
          // Normalise Haiku's slug to canonical snake_case before
          // comparing against the locked taxonomy. This rescues
          // PascalCase / kebab-case drift without losing real "the
          // model picked something not in the list" cases.
          const slug = normalizeSlug(cat.slug);
          if (slug === "__novel__") {
            skippedNovel += 1;
            continue;
          }
          const categoryId = slugToId.get(slug);
          if (!categoryId) {
            logger.warn(
              { slug, originalSlug: cat.slug, messageId: msg.id },
              "haiku produced an unknown slug — skipping",
            );
            continue;
          }
          rows.push({
            messageId: msg.id,
            categoryId,
            confidence: cat.confidence,
            source: env.ANTHROPIC_MODEL,
            model: env.ANTHROPIC_MODEL,
          });
        }
        if (rows.length > 0) {
          await db.insert(messageCategories).values(rows).onConflictDoNothing();
          tagged += 1;
        }
      } catch (err) {
        logger.error({ err, messageId: msg.id }, "tagging failed for message");
      }
    }

    return {
      result: { processed: targets.length, tagged, novel: skippedNovel },
      value: undefined,
    };
  });
}

void messages;
