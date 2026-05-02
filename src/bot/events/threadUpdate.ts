import type { ThreadChannel } from "discord.js";
import { logger } from "../../logger.ts";
import { isTrackedChannel } from "../filters.ts";
import { upsertThread } from "../../scraper/store.ts";

export async function onThreadUpdate(
  _oldThread: ThreadChannel,
  newThread: ThreadChannel,
): Promise<void> {
  const parent = newThread.parent;
  if (!parent || !isTrackedChannel(parent)) return;

  try {
    await upsertThread(newThread);
  } catch (err) {
    logger.error({ err, threadId: newThread.id }, "failed to persist thread update");
  }
}
