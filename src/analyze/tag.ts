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
import { endProgress, renderProgress } from "../util/progress.ts";
import {
  categoryIdsBySlug,
  ensureNovelCategory,
  loadTaxonomyMarkdown,
  NOVEL_SLUG,
} from "./taxonomy.ts";
import { messageTagPrompt } from "../prompts/index.ts";
import { buildMessageTagSchema, normalizeSlug } from "./schema.ts";
import { withJob } from "./job.ts";

export interface TagOptions {
  channelId?: string;
  since?: string;
  limit?: number;
  /** Number of Haiku calls in flight at once. Defaults to 5. */
  concurrency?: number;
  /**
   * Emit a `tag progress` log line every N completed messages, plus
   * once at the end. Defaults to a reasonable fraction of `limit` so
   * very small runs still show progress.
   */
  progressEvery?: number;
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
    const novelCategoryId = await ensureNovelCategory();
    const prompt = messageTagPrompt(taxonomyMarkdown);

    // Per-run schema with slug pinned to the actual taxonomy enum
    // (excluding the synthetic __novel__ marker — that one's not
    // part of the user-meaningful taxonomy, only a DB sentinel).
    // Anthropic's grammar-constrained sampling biases hard against
    // slugs outside this list; the rare grammar-bypass case is
    // handled below as a degraded "novel" outcome.
    const taxonomySlugs = [...slugToId.keys()].filter((s) => s !== NOVEL_SLUG);
    const dynamicSchema = buildMessageTagSchema(taxonomySlugs);

    const targets = await loadUntagged(opts);
    const total = targets.length;
    if (total === 0) {
      logger.info({ count: 0 }, "tagging messages — nothing to do");
      return { result: { processed: 0, tagged: 0, novel: 0 }, value: undefined };
    }

    // Clamp concurrency to keep the rate-limit retry path cheap
    // even when the user passes something silly.
    const concurrency = Math.max(1, Math.min(20, opts.concurrency ?? 5));
    const progressEvery =
      opts.progressEvery ?? Math.max(10, Math.min(100, Math.floor(total / 50) || 25));

    logger.info(
      { count: total, taxonomySize: taxonomySlugs.length, concurrency, progressEvery },
      "tagging messages",
    );

    // Shared counters mutated by all workers. JS is single-threaded
    // so the increments between awaits are race-free.
    let tagged = 0;
    let skippedNovel = 0;
    let errored = 0;
    let completed = 0;
    const startTime = Date.now();

    /**
     * Distinguishes "Haiku slipped a slug past grammar enforcement"
     * from real errors (network, server, etc.). Anthropic's enum
     * constraint is enforced at the grammar layer with very high but
     * not 100% reliability — when an out-of-list slug slips through,
     * the SDK's Zod parser rejects the response with a recognisable
     * "Failed to parse structured output" message containing
     * "Invalid option".
     *
     * Such cases mean the model genuinely couldn't fit the message
     * into the locked taxonomy, so we count it as `novel` (same
     * outcome as if the model had picked `__novel__` itself) rather
     * than as a hard error.
     */
    const isSchemaSlugMismatch = (err: unknown): boolean => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes("Failed to parse structured output") &&
        message.includes("Invalid option") &&
        message.includes("slug")
      );
    };

    /**
     * Persist a sentinel `message_categories` row for messages where
     * Haiku produced `__novel__` or slipped a non-enum slug past
     * grammar enforcement. The row points at the special `__novel__`
     * category id and uses `confidence: 0` to distinguish itself
     * from real assignments at query time. Once written, the
     * `loadUntagged` query's `NOT EXISTS` filter skips this message
     * on every future `analyze tag` run.
     */
    const markAsNovel = async (msg: TaggableMessage): Promise<void> => {
      try {
        await db
          .insert(messageCategories)
          .values({
            messageId: msg.id,
            categoryId: novelCategoryId,
            confidence: 0,
            source: env.ANTHROPIC_MODEL,
            model: env.ANTHROPIC_MODEL,
          })
          .onConflictDoNothing();
      } catch (err) {
        // Don't let a sentinel-write failure cascade — but do log it
        // since it means we'll re-tag this message next run.
        logger.warn(
          { err, messageId: msg.id },
          "failed to mark message as __novel__ — it may be re-tagged",
        );
      }
    };

    const tagOne = async (msg: TaggableMessage): Promise<void> => {
      const userBlock = `${msg.author ?? "unknown"}: ${msg.content}`;
      try {
        const response = await structured({
          system: prompt,
          user: userBlock,
          schema: dynamicSchema,
          maxTokens: 1024,
        });

        const rows: NewMessageCategory[] = [];
        let sawNovel = false;
        for (const cat of response.data.categories) {
          const slug = normalizeSlug(cat.slug);
          if (slug === NOVEL_SLUG) {
            sawNovel = true;
            continue;
          }
          const categoryId = slugToId.get(slug);
          if (!categoryId) {
            // Unreachable with enum schema; kept as defence in depth.
            sawNovel = true;
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
        } else if (sawNovel) {
          // No real categories AND Haiku flagged novel → mark the
          // message so it doesn't keep coming back on every run.
          await markAsNovel(msg);
          skippedNovel += 1;
        }
      } catch (err) {
        if (isSchemaSlugMismatch(err)) {
          // Grammar-bypass: model returned a slug outside the enum.
          // Same outcome as `__novel__` — write a sentinel and move on.
          await markAsNovel(msg);
          skippedNovel += 1;
          logger.trace(
            { messageId: msg.id },
            "haiku slipped enum constraint — marked as novel",
          );
          return;
        }
        // Real errors (network, auth, etc.) leave the message
        // untagged so the next run retries it.
        errored += 1;
        logger.error({ err, messageId: msg.id }, "tagging failed for message");
      }
    };

    const reportProgress = (force = false): void => {
      const reachedMilestone = completed % progressEvery === 0;
      const isFinal = completed === total;
      if (!force && !reachedMilestone && !isFinal) return;

      const elapsedSec = (Date.now() - startTime) / 1000;
      const rate = elapsedSec > 0 ? completed / elapsedSec : 0;
      const etaSec = rate > 0 ? (total - completed) / rate : 0;

      // Live progress bar to stderr (no-op when not a TTY)
      renderProgress({
        processed: completed,
        total,
        extras: {
          tagged,
          novel: skippedNovel,
          errored,
          "rate/sec": rate.toFixed(1),
          eta: `${Math.round(etaSec / 60)}m`,
        },
      });

      // Structured JSON log to stdout — only on milestones, so we
      // don't spam logs every single message
      if (reachedMilestone || isFinal) {
        logger.info(
          {
            processed: completed,
            total,
            percent: Math.round((completed / total) * 100),
            tagged,
            novel: skippedNovel,
            errored,
            rateMin: Math.round(rate * 60),
            etaMin: Math.round(etaSec / 60),
          },
          "tag progress",
        );
      }
    };

    // Lock-free worker pool. `cursor` is monotonic; each worker
    // claims the next unclaimed index and processes it.
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= total) return;
        const msg = targets[idx];
        if (!msg) return;
        await tagOne(msg);
        completed += 1;
        // Update the progress bar on every completion (cheap), but
        // only emit the structured JSON log every `progressEvery`
        const elapsedSec = Math.max(1, (Date.now() - startTime) / 1000);
        const ratePerSec = completed / elapsedSec;
        renderProgress({
          processed: completed,
          total,
          extras: {
            tagged,
            novel: skippedNovel,
            errored,
            "rate/sec": ratePerSec.toFixed(1),
            eta: `${Math.round((total - completed) / Math.max(0.001, ratePerSec) / 60)}m`,
          },
        });
        reportProgress();
      }
    });
    await Promise.all(workers);
    endProgress(); // newline so subsequent logs start cleanly

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    return {
      result: {
        processed: total,
        tagged,
        novel: skippedNovel,
        errored,
        elapsedSec,
        concurrency,
      },
      value: undefined,
    };
  });
}

void messages;
