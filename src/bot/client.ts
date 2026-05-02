import { Client } from "discord.js";
import { env } from "../config.ts";
import { logger } from "../logger.ts";
import { intents, partials } from "./intents.ts";
import { registerEvents, type EventOptions } from "./events/index.ts";

export interface ClientOptions {
  /** Whether to walk every tracked forum channel on ready and backfill it. */
  backfillOnReady?: boolean;
}

export function createClient(options: ClientOptions = {}): Client {
  const client = new Client({ intents, partials });

  const eventOptions: EventOptions = {
    backfillOnReady: options.backfillOnReady ?? true,
  };
  registerEvents(client, eventOptions);

  client.on("error", (err) => logger.error({ err }, "discord client error"));
  client.on("warn", (msg) => logger.warn({ msg }, "discord client warning"));

  return client;
}

export async function startBot(options: ClientOptions = {}): Promise<Client> {
  const client = createClient(options);
  await client.login(env.DISCORD_TOKEN);
  return client;
}
