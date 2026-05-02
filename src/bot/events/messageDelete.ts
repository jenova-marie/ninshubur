import type { Message, PartialMessage } from "discord.js";
import { logger } from "../../logger.ts";
import { markMessageDeleted } from "../../scraper/store.ts";

export async function onMessageDelete(
  message: Message | PartialMessage,
): Promise<void> {
  try {
    await markMessageDeleted(message.id);
  } catch (err) {
    logger.error({ err, messageId: message.id }, "failed to mark message deleted");
  }
}
