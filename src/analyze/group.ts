import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  messageGroupMembers,
  messageGroups,
  messages,
} from "../db/schema/index.ts";
import { env } from "../config.ts";
import { logger } from "../logger.ts";
import { structured } from "../llm/haiku.ts";
import { groupWindowPrompt } from "../prompts/index.ts";
import { groupWindowSchema } from "./schema.ts";
import { withJob } from "./job.ts";
import { endProgress, renderProgress } from "../util/progress.ts";

export interface GroupOptions {
  channelId?: string;
  since?: string;
  windowSize?: number;
  /** Number of windows processed in parallel. Defaults to 5. */
  concurrency?: number;
}

interface GroupableMessage {
  id: string;
  channelId: string;
  threadId: string | null;
  content: string;
  author: string | null;
  createdAt: Date;
}

async function loadUngrouped(opts: GroupOptions): Promise<GroupableMessage[]> {
  // Pull every message that isn't already a member of any group, in
  // chronological order, scoped to the optional channel/since filters.
  const conds = [
    sql`NOT EXISTS (SELECT 1 FROM message_group_members mgm WHERE mgm.message_id = ${messages.id})`,
    sql`COALESCE(NULLIF(${messages.content}, ''), ${messages.messageSnapshots}->0->>'content', '') <> ''`,
  ];
  if (opts.channelId) conds.push(eq(messages.channelId, opts.channelId));
  if (opts.since) conds.push(gte(messages.createdAt, new Date(opts.since)));

  const rows = await db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      threadId: messages.threadId,
      content: sql<string>`COALESCE(NULLIF(${messages.content}, ''), ${messages.messageSnapshots}->0->>'content', '')`,
      author: sql<string | null>`(SELECT username FROM users WHERE users.id = ${messages.authorId})`,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(...conds))
    .orderBy(asc(messages.channelId), asc(messages.createdAt));
  return rows;
}

interface ChannelBatch {
  channelId: string;
  msgs: GroupableMessage[];
}

function groupByChannel(rows: GroupableMessage[]): ChannelBatch[] {
  const map = new Map<string, GroupableMessage[]>();
  for (const row of rows) {
    const list = map.get(row.channelId) ?? [];
    list.push(row);
    map.set(row.channelId, list);
  }
  return [...map.entries()].map(([channelId, msgs]) => ({ channelId, msgs }));
}

interface WindowJob {
  channelId: string;
  offset: number;
  window: GroupableMessage[];
}

export async function runGroup(opts: GroupOptions = {}): Promise<void> {
  const windowSize = Math.max(2, Math.min(40, opts.windowSize ?? 15));
  const concurrency = Math.max(1, Math.min(20, opts.concurrency ?? 5));

  await withJob("group", { ...opts, windowSize, concurrency }, async () => {
    const all = await loadUngrouped(opts);
    if (all.length === 0) {
      return { result: { groups: 0, messages: 0 }, value: undefined };
    }

    const batches = groupByChannel(all);

    // Pre-compute every (channel, offset, window) tuple so we can
    // distribute work across a single worker pool rather than nesting
    // a sequential loop inside a sequential loop.
    const jobs: WindowJob[] = [];
    for (const batch of batches) {
      for (let offset = 0; offset < batch.msgs.length; offset += windowSize) {
        const window = batch.msgs.slice(offset, offset + windowSize);
        if (window.length > 0) {
          jobs.push({ channelId: batch.channelId, offset, window });
        }
      }
    }

    const total = jobs.length;
    const progressEvery = Math.max(5, Math.min(50, Math.floor(total / 30) || 5));

    logger.info(
      {
        windowJobs: total,
        channels: batches.length,
        windowSize,
        concurrency,
        progressEvery,
      },
      "grouping in window-batch mode",
    );

    let totalGroups = 0;
    let totalMessages = 0;
    let errored = 0;
    let completed = 0;
    const startTime = Date.now();

    const processWindow = async (job: WindowJob): Promise<void> => {
      const userBlock = job.window
        .map((m, idx) => `[${idx}] ${m.author ?? "unknown"}: ${m.content}`)
        .join("\n");

      try {
        const response = await structured({
          system: groupWindowPrompt,
          user: `Window of ${job.window.length} consecutive messages:\n\n${userBlock}`,
          schema: groupWindowSchema,
          maxTokens: 2048,
        });

        for (const g of response.data.groups) {
          const start = Math.max(0, Math.min(job.window.length - 1, g.startIndex));
          const end = Math.max(start, Math.min(job.window.length - 1, g.endIndex));
          const slice = job.window.slice(start, end + 1);
          if (slice.length === 0) continue;

          const firstMessage = slice[0];
          const lastMessage = slice[slice.length - 1];
          if (!firstMessage || !lastMessage) continue;

          const [groupRow] = await db
            .insert(messageGroups)
            .values({
              channelId: job.channelId,
              threadId: firstMessage.threadId,
              summary: g.summary,
              startedAt: firstMessage.createdAt,
              endedAt: lastMessage.createdAt,
              messageCount: slice.length,
              model: env.ANTHROPIC_MODEL,
            })
            .returning();
          if (!groupRow) continue;

          await db.insert(messageGroupMembers).values(
            slice.map((m, idx) => ({
              groupId: groupRow.id,
              messageId: m.id,
              position: idx,
            })),
          );
          totalGroups += 1;
          totalMessages += slice.length;
        }
      } catch (err) {
        errored += 1;
        logger.error(
          { err, channelId: job.channelId, offset: job.offset },
          "grouping failed for window",
        );
      }
    };

    const reportProgress = (): void => {
      if (completed % progressEvery !== 0 && completed !== total) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const rate = elapsedSec > 0 ? completed / elapsedSec : 0;
      const etaSec = rate > 0 ? (total - completed) / rate : 0;
      logger.info(
        {
          processed: completed,
          total,
          percent: Math.round((completed / total) * 100),
          groups: totalGroups,
          messagesGrouped: totalMessages,
          errored,
          rateMin: Math.round(rate * 60),
          etaMin: Math.round(etaSec / 60),
        },
        "group progress",
      );
    };

    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= total) return;
        const job = jobs[idx];
        if (!job) return;
        await processWindow(job);
        completed += 1;
        // Live bar on stderr (TTY only)
        renderProgress({
          processed: completed,
          total,
          extras: {
            groups: totalGroups,
            messages: totalMessages,
            errored,
            "rate/min": Math.round(
              (completed / Math.max(1, (Date.now() - startTime) / 1000)) * 60,
            ),
          },
        });
        reportProgress();
      }
    });
    await Promise.all(workers);
    endProgress();

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    return {
      result: {
        groups: totalGroups,
        messages: totalMessages,
        errored,
        elapsedSec,
        concurrency,
      },
      value: undefined,
    };
  });
}

void isNull;
