import { Command } from "commander";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/index.ts";
import { runTaxonomy } from "../analyze/taxonomy.ts";
import { runTag } from "../analyze/tag.ts";
import { runGroup } from "../analyze/group.ts";
import { runEmbed, type EmbedScope } from "../analyze/embed.ts";

export function registerAnalyzeCommand(program: Command): void {
  const analyze = program
    .command("analyze")
    .description("LLM analysis pipeline (Haiku tagging + grouping → Voyage embeddings → Qdrant)");

  analyze
    .command("taxonomy")
    .description("Phase A — discover + curate the message-type taxonomy")
    .option("--sample <n>", "Number of messages to sample for discovery", "200")
    .option("--recurate", "Replace the existing taxonomy")
    .action(async (opts: { sample: string; recurate?: boolean }) => {
      try {
        await runTaxonomy({
          sample: Number(opts.sample),
          recurate: opts.recurate ?? false,
        });
      } finally {
        await pool.end();
      }
    });

  analyze
    .command("tag")
    .description("Phase B — assign categories to each untagged message")
    .option("-c, --channel <id>", "Restrict to this channel")
    .option("--since <iso>", "Only tag messages on/after this ISO timestamp")
    .option("--limit <n>", "Max messages to tag this run", "1000")
    .action(
      async (opts: { channel?: string; since?: string; limit: string }) => {
        try {
          await runTag({
            ...(opts.channel ? { channelId: opts.channel } : {}),
            ...(opts.since ? { since: opts.since } : {}),
            limit: Number(opts.limit),
          });
        } finally {
          await pool.end();
        }
      },
    );

  analyze
    .command("group")
    .description("Phase C — group consecutive messages into lessons via window-batch")
    .option("-c, --channel <id>", "Restrict to this channel")
    .option("--since <iso>", "Only group messages on/after this ISO timestamp")
    .option("--window <n>", "Window size in messages (2-40)", "15")
    .action(
      async (opts: { channel?: string; since?: string; window: string }) => {
        try {
          await runGroup({
            ...(opts.channel ? { channelId: opts.channel } : {}),
            ...(opts.since ? { since: opts.since } : {}),
            windowSize: Number(opts.window),
          });
        } finally {
          await pool.end();
        }
      },
    );

  analyze
    .command("embed")
    .description("Phase D — embed messages + groups via Voyage and push to Qdrant")
    .option("--scope <which>", "all | messages | groups", "all")
    .option("--limit <n>", "Cap per-scope embed jobs (debug)", "10000")
    .option(
      "--force",
      "Re-embed every row in scope, even if already embedded with this model. Use after changing the embed-text format (e.g. summary inclusion).",
    )
    .action(
      async (opts: { scope: EmbedScope; limit: string; force?: boolean }) => {
        try {
          await runEmbed({
            scope: opts.scope,
            limit: Number(opts.limit),
            force: opts.force ?? false,
          });
        } finally {
          await pool.end();
        }
      },
    );

  analyze
    .command("status")
    .description("Show recent analyze job runs from llm_jobs")
    .option("--limit <n>", "Most recent N rows", "20")
    .action(async (opts: { limit: string }) => {
      try {
        const rows = await db.execute(
          sql`
            SELECT kind, status,
                   to_char(started_at, 'YYYY-MM-DD HH24:MI') AS started,
                   COALESCE(EXTRACT(EPOCH FROM (finished_at - started_at))::int, 0) AS secs,
                   COALESCE(result::text, '') AS result,
                   error
            FROM llm_jobs
            ORDER BY started_at DESC
            LIMIT ${Number(opts.limit)}
          `,
        );
        for (const row of rows.rows) {
          process.stdout.write(`${JSON.stringify(row)}\n`);
        }
      } finally {
        await pool.end();
      }
    });
}
