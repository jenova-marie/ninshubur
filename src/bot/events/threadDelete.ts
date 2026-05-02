import type { ThreadChannel } from "discord.js";
import { logger } from "../../logger.ts";
import { markThreadDeleted } from "../../scraper/store.ts";

export async function onThreadDelete(thread: ThreadChannel): Promise<void> {
  try {
    await markThreadDeleted(thread.id);
  } catch (err) {
    logger.error({ err, threadId: thread.id }, "failed to mark thread deleted");
  }
}
