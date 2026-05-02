import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { categories, messages, type NewCategory } from "../db/schema/index.ts";
import { env } from "../config.ts";
import { logger } from "../logger.ts";
import { structured } from "../llm/haiku.ts";
import { withJob } from "./job.ts";
import {
  taxonomyCurationPrompt,
  taxonomyDiscoveryPrompt,
} from "../prompts/index.ts";
import {
  normalizeSlug,
  taxonomyCurationSchema,
  taxonomyDiscoverySchema,
} from "./schema.ts";

export interface TaxonomyOptions {
  /** How many messages to sample for discovery. */
  sample?: number;
  /** When true, replace the existing taxonomy with the new one (else fail if categories already exist). */
  recurate?: boolean;
}

interface SampleRow {
  id: string;
  content: string;
  author: string | null;
}

async function sampleMessages(limit: number): Promise<SampleRow[]> {
  const rows = await db.execute(
    sql`
      SELECT m.id::text AS id,
             COALESCE(NULLIF(m.content, ''),
                      m.message_snapshots->0->>'content',
                      '') AS content,
             u.username AS author
      FROM messages m
      LEFT JOIN users u ON u.id = m.author_id
      WHERE COALESCE(NULLIF(m.content, ''),
                     m.message_snapshots->0->>'content', '') <> ''
      ORDER BY random()
      LIMIT ${limit}
    `,
  );
  return rows.rows as unknown as SampleRow[];
}

export async function runTaxonomy(opts: TaxonomyOptions = {}): Promise<void> {
  const sampleSize = opts.sample ?? 200;

  await withJob("taxonomy", { sample: sampleSize, recurate: !!opts.recurate }, async () => {
    const existing = await db.select({ id: categories.id }).from(categories);
    if (existing.length > 0 && !opts.recurate) {
      throw new Error(
        `categories table already has ${existing.length} rows; pass --recurate to replace`,
      );
    }

    logger.info({ sampleSize }, "sampling messages for taxonomy discovery");
    const sample = await sampleMessages(sampleSize);
    if (sample.length === 0) {
      throw new Error("no messages with content available — backfill first");
    }

    // ── Phase A1: discovery ───────────────────────────────────────
    const discoveryUser = sample
      .map((row, idx) => `[${idx}] ${row.author ?? "unknown"}: ${row.content}`)
      .join("\n");

    const discovery = await structured({
      system: taxonomyDiscoveryPrompt,
      user: `Here are ${sample.length} sample messages. Propose a category taxonomy.\n\n${discoveryUser}`,
      schema: taxonomyDiscoverySchema,
      maxTokens: 4096,
    });
    logger.info(
      {
        candidateCount: discovery.data.categories.length,
        usage: discovery.usage,
      },
      "taxonomy discovery complete",
    );

    // ── Phase A2: curation ────────────────────────────────────────
    const curationUser = `Candidate categories from discovery:\n\n${discovery.data.categories
      .map((c) => `- ${c.slug}: ${c.name} — ${c.description}`)
      .join("\n")}`;

    const curated = await structured({
      system: taxonomyCurationPrompt,
      user: curationUser,
      schema: taxonomyCurationSchema,
      maxTokens: 4096,
    });
    logger.info(
      {
        merges: curated.data.merges.length,
        finalCount: curated.data.finalCategories.length,
        usage: curated.usage,
      },
      "taxonomy curation complete",
    );

    // ── Persist ───────────────────────────────────────────────────
    if (opts.recurate) {
      await db.delete(categories);
      logger.warn("existing categories deleted (recurate)");
    }

    // Normalise to canonical snake_case at persist time so the
    // `categories.slug` column never holds mixed casing or hyphens.
    const rows: NewCategory[] = curated.data.finalCategories.map((c) => ({
      slug: normalizeSlug(c.slug),
      name: c.name,
      description: c.description,
      source: env.ANTHROPIC_MODEL,
    }));
    await db.insert(categories).values(rows);

    return {
      result: {
        sampleSize: sample.length,
        candidateCount: discovery.data.categories.length,
        finalCount: curated.data.finalCategories.length,
        merges: curated.data.merges.length,
      },
      value: undefined,
    };
  });
}

export async function loadTaxonomyMarkdown(): Promise<string> {
  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
    })
    .from(categories)
    .orderBy(categories.slug);
  if (rows.length === 0) {
    throw new Error(
      "no categories yet — run `pnpm cli analyze taxonomy` first",
    );
  }
  return rows
    .map((r) => `- \`${r.slug}\` — **${r.name}**: ${r.description ?? ""}`)
    .join("\n");
}

/**
 * Resolve the canonical category by slug. Used by the tagging phase.
 */
export async function categoryIdsBySlug(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  return new Map(rows.map((r) => [r.slug, r.id]));
}

void messages; // keep export side-effect free; messages import is for future joins
