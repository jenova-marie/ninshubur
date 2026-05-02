import { GatewayIntentBits, Partials } from "discord.js";

/**
 * Intents required to scrape forum channels.
 *
 * - Guilds: receive guild + channel + thread metadata events.
 * - GuildMessages: needed to receive `messageCreate` and friends.
 * - MessageContent: required (and a privileged intent in the dev portal)
 *   to read the actual text of messages.
 * - GuildMessageReactions: keep reaction counts in sync.
 *
 * Partials let us process events for objects we have not seen yet — for
 * example a message edit on a message that pre-dated the bot's join.
 */
export const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMessageReactions,
];

export const partials = [
  Partials.Channel,
  Partials.Message,
  Partials.Reaction,
  Partials.ThreadMember,
];
