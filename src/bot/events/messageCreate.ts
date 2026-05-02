import type { Message } from "discord.js";
import { logger } from "../../logger.ts";
import { isTrackedChannel } from "../filters.ts";
import { upsertMessage } from "../../scraper/store.ts";

export async function onMessageCreate(message: Message): Promise<void> {
  if (!message.inGuild()) return;

  const channel = message.channel;
  const tracked = channel.isThread()
    ? channel.parent && isTrackedChannel(channel.parent)
    : isTrackedChannel(channel);
  if (!tracked) return;

  try {
    await upsertMessage(message);
  } catch (err) {
    logger.error({ err, messageId: message.id }, "failed to persist message");
  }
}
