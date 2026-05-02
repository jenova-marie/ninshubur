import { sql } from "drizzle-orm";
import {
  ChannelType,
  type Collection,
  type FetchArchivedThreadOptions,
  type ForumChannel,
  type GuildBasedChannel,
  type MediaChannel,
  type Message,
  type NewsChannel,
  type StageChannel,
  type TextChannel,
  type ThreadChannel,
  type VoiceChannel,
} from "discord.js";
import { env } from "../config.ts";
import { db } from "../db/index.ts";
import { scrapeState } from "../db/schema/index.ts";
import { logger } from "../logger.ts";
import {
  canReadChannel,
  isAuthorTracked,
  isForumLikeChannel,
  isTextLikeChannel,
} from "../bot/filters.ts";
import { upsertChannel, upsertMessage, upsertThread } from "./store.ts";

type TextLikeChannel = TextChannel | NewsChannel | VoiceChannel | StageChannel;
type ForumLikeChannel = ForumChannel | MediaChannel;

interface FetchOptions {
  limit: number;
  before?: string;
  after?: string;
}

type MessageFetcher = (
  opts: FetchOptions,
) => Promise<Collection<string, Message>>;

interface WalkResult {
  totalKept: number;
  totalFetched: number;
  newestId: string | null;
}

/**
 * Walk every message reachable through `fetcher`, applying the author
 * allowlist and persisting the survivors via `upsertMessage`.
 *
 * Discord's REST `GET /channels/{id}/messages` only returns messages
 * in newest-first order. To capture full history we walk *backward*
 * with `before:` until the channel is exhausted. To do an incremental
 * top-up after we already have a cursor we walk *forward* with
 * `after:` from that cursor.
 */
async function walkAndPersist(
  fetcher: MessageFetcher,
  cursorId: string | null,
): Promise<WalkResult> {
  const limit = env.BACKFILL_PAGE_SIZE;
  let totalKept = 0;
  let totalFetched = 0;
  let newestId: string | null = cursorId;

  const visit = async (msg: Message): Promise<void> => {
    if (!msg.inGuild()) return;
    totalFetched += 1;
    if (newestId === null || BigInt(msg.id) > BigInt(newestId)) {
      newestId = msg.id;
    }
    if (!isAuthorTracked(msg.author?.id)) return;
    try {
      await upsertMessage(msg);
      totalKept += 1;
    } catch (err) {
      // Log + continue so one rogue message can't take down a backfill
      // that's been running for hours. The cursor will still advance
      // (newestId was already updated above), so we won't loop on the
      // same failure forever.
      logger.error(
        { err, messageId: msg.id, channelId: msg.channelId },
        "failed to persist message during backfill",
      );
    }
  };

  /**
   * Discord REST errors we treat as "stop scraping this scope" rather
   * than fatal: the bot lacks permission, the channel was deleted, or
   * the message we paged on disappeared.
   */
  const isSkippableRestError = (err: unknown): boolean => {
    if (typeof err !== "object" || err === null) return false;
    const e = err as { code?: number; status?: number };
    return e.code === 50001 || e.code === 50013 || e.code === 10003 || e.code === 10008;
  };

  try {
    if (cursorId) {
      // Incremental top-up: forward walk from the saved cursor.
      let after: string = cursorId;
      while (true) {
        const page = await fetcher({ limit, after });
        if (page.size === 0) break;
        const chrono = [...page.values()].sort((a, b) =>
          Number(BigInt(a.id) - BigInt(b.id)),
        );
        for (const msg of chrono) await visit(msg);
        if (page.size < limit) break;
        const lastId = chrono[chrono.length - 1]?.id;
        if (!lastId) break;
        after = lastId;
      }
    } else {
      // Full history: backward walk from the latest message.
      let before: string | undefined = undefined;
      while (true) {
        const opts: FetchOptions = { limit };
        if (before) opts.before = before;
        const page = await fetcher(opts);
        if (page.size === 0) break;
        const chrono = [...page.values()].sort((a, b) =>
          Number(BigInt(a.id) - BigInt(b.id)),
        );
        for (const msg of chrono) await visit(msg);
        if (page.size < limit) break;
        const oldestId = chrono[0]?.id;
        if (!oldestId) break;
        before = oldestId;
      }
    }
  } catch (err) {
    if (isSkippableRestError(err)) {
      logger.warn(
        { err: { code: (err as { code?: number }).code }, totalFetched, totalKept },
        "REST error during page walk — stopping early",
      );
    } else {
      throw err;
    }
  }

  return { totalKept, totalFetched, newestId };
}

/**
 * Top-level dispatcher: pick the right strategy based on channel type.
 * No-op for channel types we cannot scrape, and gracefully skips
 * channels where the bot lacks ViewChannel/ReadMessageHistory.
 */
export async function backfillChannel(channel: GuildBasedChannel): Promise<void> {
  await upsertChannel(channel);

  const client = channel.client;
  if (client.user && !canReadChannel(channel, client as Parameters<typeof canReadChannel>[1])) {
    logger.warn(
      { channelId: channel.id, name: channel.name },
      "skipping channel — bot lacks ViewChannel/ReadMessageHistory",
    );
    return;
  }

  if (isForumLikeChannel(channel.type)) {
    await backfillForumChannel(channel as ForumLikeChannel);
    return;
  }
  if (isTextLikeChannel(channel.type)) {
    await backfillTextChannel(channel as TextLikeChannel);
    return;
  }
  logger.debug(
    { channelId: channel.id, type: channel.type },
    "skipping non-scrapable channel",
  );
}

/**
 * Walk every active and archived thread on a forum/media channel and
 * persist threads + their full message history.
 */
export async function backfillForumChannel(channel: ForumLikeChannel): Promise<void> {
  logger.info({ channelId: channel.id, name: channel.name }, "backfilling forum");

  const active = await channel.threads.fetchActive();
  for (const [, thread] of active.threads) {
    await backfillThread(thread);
  }

  let before: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const opts: FetchArchivedThreadOptions = { type: "public", limit: 100 };
    if (before) opts.before = before;
    const archived = await channel.threads.fetchArchived(opts);
    for (const [, thread] of archived.threads) {
      await backfillThread(thread);
      before = thread.id;
    }
    hasMore = archived.hasMore;
    if (archived.threads.size === 0) hasMore = false;
  }

  logger.info({ channelId: channel.id }, "forum backfill complete");
}

/**
 * Walk every message in a text-like channel, then walk any threads
 * spawned from that channel.
 */
export async function backfillTextChannel(channel: TextLikeChannel): Promise<void> {
  logger.info({ channelId: channel.id, name: channel.name }, "backfilling text channel");

  const cursor = await db.query.scrapeState.findFirst({
    where: sql`${scrapeState.scopeId} = ${channel.id}`,
  });

  const { totalKept, totalFetched, newestId } = await walkAndPersist(
    (opts) => channel.messages.fetch(opts),
    cursor?.lastMessageId ?? null,
  );

  await recordCursor({
    scopeId: channel.id,
    scopeType: "channel",
    lastMessageId: newestId,
    previousFullScrape: cursor?.lastFullScrapeAt ?? null,
  });

  // Threads spawned from text/announcement channels
  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  ) {
    const active = await channel.threads.fetchActive().catch(() => null);
    for (const [, thread] of active?.threads ?? []) {
      await backfillThread(thread);
    }
    const archived = await channel.threads
      .fetchArchived({ limit: 100 })
      .catch(() => null);
    for (const [, thread] of archived?.threads ?? []) {
      await backfillThread(thread);
    }
  }

  logger.info(
    { channelId: channel.id, totalKept, totalFetched },
    "text channel backfill complete",
  );
}

/**
 * Pull every message in a single thread.
 * Resumes from `scrape_state.last_message_id` when present, otherwise
 * walks backward from the most recent message until the thread is
 * exhausted.
 */
export async function backfillThread(thread: ThreadChannel): Promise<void> {
  await upsertThread(thread);

  if (!thread.viewable) {
    logger.warn({ threadId: thread.id }, "thread not viewable, skipping backfill");
    return;
  }

  if (thread.joinable && !thread.joined) {
    await thread.join().catch((err: unknown) =>
      logger.warn({ err, threadId: thread.id }, "could not join thread"),
    );
  }

  const cursor = await db.query.scrapeState.findFirst({
    where: sql`${scrapeState.scopeId} = ${thread.id}`,
  });

  const { totalKept, totalFetched, newestId } = await walkAndPersist(
    (opts) => thread.messages.fetch(opts),
    cursor?.lastMessageId ?? null,
  );

  await recordCursor({
    scopeId: thread.id,
    scopeType: "thread",
    lastMessageId: newestId,
    previousFullScrape: cursor?.lastFullScrapeAt ?? null,
  });

  logger.info({ threadId: thread.id, totalKept, totalFetched }, "thread backfill done");
}

async function recordCursor(args: {
  scopeId: string;
  scopeType: "channel" | "thread";
  lastMessageId: string | null;
  previousFullScrape: Date | null;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(scrapeState)
    .values({
      scopeId: args.scopeId,
      scopeType: args.scopeType,
      lastMessageId: args.lastMessageId,
      lastFullScrapeAt: args.previousFullScrape ?? now,
      lastIncrementalScrapeAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: scrapeState.scopeId,
      set: {
        scopeType: args.scopeType,
        lastMessageId: args.lastMessageId,
        lastIncrementalScrapeAt: now,
        updatedAt: now,
      },
    });
}
