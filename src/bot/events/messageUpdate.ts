import type { Message, PartialMessage } from "discord.js";
import { logger } from "../../logger.ts";
import { isTrackedChannel } from "../filters.ts";
import { upsertMessage } from "../../scraper/store.ts";

export async function onMessageUpdate(
  _oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> {
  const message = newMessage.partial
    ? await newMessage.fetch().catch(() => null)
    : newMessage;
  if (!message) return;
  if (!message.inGuild()) return;

  const channel = message.channel;
  const tracked = channel.isThread()
    ? channel.parent && isTrackedChannel(channel.parent)
    : isTrackedChannel(channel);
  if (!tracked) return;

  try {
    await upsertMessage(message);
  } catch (err) {
    logger.error({ err, messageId: message.id }, "failed to persist message edit");
  }
}
