import type { ThreadChannel } from "discord.js";
import { logger } from "../../logger.ts";
import { isTrackedChannel } from "../filters.ts";
import { backfillThread } from "../../scraper/channels.ts";
import { upsertThread } from "../../scraper/store.ts";

export async function onThreadCreate(thread: ThreadChannel): Promise<void> {
  const parent = thread.parent;
  if (!parent || !isTrackedChannel(parent)) return;

  try {
    if (thread.joinable && !thread.joined) await thread.join();
    await upsertThread(thread);
    await backfillThread(thread);
  } catch (err) {
    logger.error({ err, threadId: thread.id }, "failed to handle thread create");
  }
}
