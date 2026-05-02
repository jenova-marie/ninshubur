import type { Client, GuildBasedChannel } from "discord.js";
import { logger } from "../../logger.ts";
import { isTrackedChannel } from "../filters.ts";
import { upsertChannel, upsertGuild } from "../../scraper/store.ts";
import { backfillChannel } from "../../scraper/channels.ts";
import type { EventOptions } from "./index.ts";

export function makeOnReady(options: EventOptions) {
  return async function onReady(client: Client<true>): Promise<void> {
    logger.info(
      { tag: client.user.tag, id: client.user.id, backfill: options.backfillOnReady },
      "ninshubur is online",
    );

    for (const [, guild] of client.guilds.cache) {
      await upsertGuild(guild);
      const channels = await guild.channels.fetch();
      for (const [, channel] of channels) {
        if (!channel) continue;
        if (!isTrackedChannel(channel as GuildBasedChannel)) continue;
        await upsertChannel(channel as GuildBasedChannel);
        if (options.backfillOnReady) {
          backfillChannel(channel as GuildBasedChannel).catch((err: unknown) =>
            logger.error({ err, channelId: channel.id }, "backfill failed"),
          );
        }
      }
    }
  };
}
