import {
  ChannelType,
  PermissionsBitField,
  type Client,
  type GuildBasedChannel,
} from "discord.js";
import { env } from "../config.ts";

/**
 * Channel types that hold messages directly (i.e. you can call
 * `channel.messages.fetch(...)` against them).
 */
export const TEXT_LIKE_CHANNEL_TYPES: ChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
];

/**
 * Channel types that act as forum-style containers — they hold posts
 * (threads) rather than direct messages.
 */
export const FORUM_LIKE_CHANNEL_TYPES: ChannelType[] = [
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
];

export function isTextLikeChannel(type: ChannelType): boolean {
  return TEXT_LIKE_CHANNEL_TYPES.includes(type);
}

export function isForumLikeChannel(type: ChannelType): boolean {
  return FORUM_LIKE_CHANNEL_TYPES.includes(type);
}

export function isScrapableChannel(type: ChannelType): boolean {
  return isTextLikeChannel(type) || isForumLikeChannel(type);
}

export function isTrackedGuild(guildId: string): boolean {
  if (env.DISCORD_GUILD_IDS.length === 0) return true;
  return env.DISCORD_GUILD_IDS.includes(guildId);
}

/**
 * Whether a message authored by `authorId` should be persisted.
 *
 * When `USER_IDS` is empty we keep every message. When it is set, we
 * only persist messages whose author appears in the allowlist. A null
 * author (e.g. system messages, webhook fallback) never matches.
 */
export function isAuthorTracked(authorId: string | null | undefined): boolean {
  if (env.USER_IDS.length === 0) return true;
  if (!authorId) return false;
  return env.USER_IDS.includes(authorId);
}

/**
 * Whether the bot should scrape this channel based on guild + channel
 * allowlists. Accepts any channel — non-scrapable types always return
 * false.
 */
export function isTrackedChannel(channel: GuildBasedChannel): boolean {
  if (!isScrapableChannel(channel.type)) return false;
  if (!isTrackedGuild(channel.guildId)) return false;
  if (env.CHANNEL_IDS.length === 0) return true;
  return env.CHANNEL_IDS.includes(channel.id);
}

/**
 * Whether the bot's own member has the role permissions required to
 * read message history in this channel. Returns `true` when we cannot
 * resolve the bot member — the API call will surface a 50001 if we
 * really don't have access, which `walkAndPersist` handles by
 * skipping the channel.
 */
export function canReadChannel(
  channel: GuildBasedChannel,
  client: Client<true>,
): boolean {
  const me = channel.guild.members.me ?? channel.guild.members.resolve(client.user.id);
  if (!me) return true;
  const perms = channel.permissionsFor(me);
  if (!perms) return true;
  return perms.has([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
  ]);
}
