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

export interface GroupOptions {
  channelId?: string;
  since?: string;
  windowSize?: number;
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

export async function runGroup(opts: GroupOptions = {}): Promise<void> {
  const windowSize = Math.max(2, Math.min(40, opts.windowSize ?? 15));

  await withJob("group", { ...opts, windowSize }, async () => {
    const all = await loadUngrouped(opts);
    if (all.length === 0) {
      return { result: { groups: 0, messages: 0 }, value: undefined };
    }

    const batches = groupByChannel(all);
    let totalGroups = 0;
    let totalMessages = 0;

    for (const batch of batches) {
      logger.info(
        { channelId: batch.channelId, msgs: batch.msgs.length, windowSize },
        "grouping channel",
      );
      for (let offset = 0; offset < batch.msgs.length; offset += windowSize) {
        const window = batch.msgs.slice(offset, offset + windowSize);
        if (window.length === 0) break;

        const userBlock = window
          .map((m, idx) => `[${idx}] ${m.author ?? "unknown"}: ${m.content}`)
          .join("\n");

        try {
          const response = await structured({
            system: groupWindowPrompt,
            user: `Window of ${window.length} consecutive messages:\n\n${userBlock}`,
            schema: groupWindowSchema,
            maxTokens: 2048,
          });

          for (const g of response.data.groups) {
            const start = Math.max(0, Math.min(window.length - 1, g.startIndex));
            const end = Math.max(start, Math.min(window.length - 1, g.endIndex));
            const slice = window.slice(start, end + 1);
            if (slice.length === 0) continue;

            const firstMessage = slice[0];
            const lastMessage = slice[slice.length - 1];
            if (!firstMessage || !lastMessage) continue;
            const [groupRow] = await db
              .insert(messageGroups)
              .values({
                channelId: batch.channelId,
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
          logger.error(
            { err, channelId: batch.channelId, offset },
            "grouping failed for window",
          );
        }
      }
    }

    return {
      result: { groups: totalGroups, messages: totalMessages },
      value: undefined,
    };
  });
}

void isNull;
