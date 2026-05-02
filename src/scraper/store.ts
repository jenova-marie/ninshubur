import { sql } from "drizzle-orm";
import {
  ChannelType,
  type ForumChannel as DiscordForumChannel,
  type Guild as DiscordGuild,
  type GuildBasedChannel,
  type MediaChannel as DiscordMediaChannel,
  type Message,
  type ThreadChannel,
  type User as DiscordUser,
} from "discord.js";
import { db } from "../db/index.ts";
import {
  attachments,
  channels,
  forumTags,
  guilds,
  messages,
  reactions,
  threadAppliedTags,
  threads,
  users,
  type NewAttachment,
  type NewChannel,
  type NewForumTag,
  type NewGuild,
  type NewMessage,
  type NewReaction,
  type NewThread,
  type NewUser,
} from "../db/schema/index.ts";
import { isAuthorTracked, isForumLikeChannel } from "../bot/filters.ts";

export async function upsertGuild(guild: DiscordGuild): Promise<void> {
  const row: NewGuild = {
    id: guild.id,
    name: guild.name,
    iconHash: guild.icon ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(guilds)
    .values(row)
    .onConflictDoUpdate({
      target: guilds.id,
      set: { name: row.name, iconHash: row.iconHash, updatedAt: row.updatedAt },
    });
}

/**
 * Upsert any guild-based channel that we know how to scrape: text,
 * announcement, voice (with text), forum, or media. Forum-only fields
 * are populated when the channel is a forum or media channel.
 */
export async function upsertChannel(channel: GuildBasedChannel): Promise<void> {
  const isForumLike = isForumLikeChannel(channel.type);
  const forumish = isForumLike
    ? (channel as DiscordForumChannel | DiscordMediaChannel)
    : null;

  const row: NewChannel = {
    id: channel.id,
    guildId: channel.guildId,
    type: channel.type,
    name: channel.name,
    topic: "topic" in channel ? (channel.topic ?? null) : null,
    parentId: channel.parentId,
    position: "position" in channel ? (channel.position ?? null) : null,
    nsfw: "nsfw" in channel ? Boolean(channel.nsfw) : false,
    rateLimitPerUser:
      "rateLimitPerUser" in channel ? (channel.rateLimitPerUser ?? null) : null,
    lastMessageId:
      "lastMessageId" in channel ? (channel.lastMessageId ?? null) : null,
    defaultAutoArchiveDuration: forumish?.defaultAutoArchiveDuration ?? null,
    defaultThreadRateLimitPerUser:
      forumish?.defaultThreadRateLimitPerUser ?? null,
    defaultSortOrder: forumish?.defaultSortOrder ?? null,
    defaultForumLayout:
      channel.type === ChannelType.GuildForum
        ? (channel as DiscordForumChannel).defaultForumLayout
        : null,
    defaultReactionEmoji: forumish?.defaultReactionEmoji
      ? {
          emojiId: forumish.defaultReactionEmoji.id,
          emojiName: forumish.defaultReactionEmoji.name,
        }
      : null,
    flags: "flags" in channel ? (channel.flags?.bitfield ?? 0) : 0,
    updatedAt: new Date(),
  };

  await db
    .insert(channels)
    .values(row)
    .onConflictDoUpdate({
      target: channels.id,
      set: {
        type: row.type,
        name: row.name,
        topic: row.topic,
        parentId: row.parentId,
        position: row.position,
        nsfw: row.nsfw,
        rateLimitPerUser: row.rateLimitPerUser,
        lastMessageId: row.lastMessageId,
        defaultAutoArchiveDuration: row.defaultAutoArchiveDuration,
        defaultThreadRateLimitPerUser: row.defaultThreadRateLimitPerUser,
        defaultSortOrder: row.defaultSortOrder,
        defaultForumLayout: row.defaultForumLayout,
        defaultReactionEmoji: row.defaultReactionEmoji,
        flags: row.flags,
        updatedAt: row.updatedAt,
      },
    });

  if (forumish) {
    const tagRows: NewForumTag[] = forumish.availableTags.map((tag) => ({
      id: tag.id,
      channelId: channel.id,
      name: tag.name,
      moderated: tag.moderated,
      emojiId: tag.emoji?.id ?? null,
      emojiName: tag.emoji?.name ?? null,
    }));
    if (tagRows.length > 0) {
      await db
        .insert(forumTags)
        .values(tagRows)
        .onConflictDoUpdate({
          target: forumTags.id,
          set: {
            name: sql`excluded.name`,
            moderated: sql`excluded.moderated`,
            emojiId: sql`excluded.emoji_id`,
            emojiName: sql`excluded.emoji_name`,
          },
        });
    }
  }
}

export async function upsertUser(user: DiscordUser): Promise<void> {
  const row: NewUser = {
    id: user.id,
    username: user.username,
    globalName: user.globalName ?? null,
    discriminator: user.discriminator,
    avatarHash: user.avatar ?? null,
    bot: user.bot,
    system: user.system,
    publicFlags: user.flags?.bitfield ?? null,
    lastSeenAt: new Date(),
  };
  await db
    .insert(users)
    .values(row)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        username: row.username,
        globalName: row.globalName,
        discriminator: row.discriminator,
        avatarHash: row.avatarHash,
        bot: row.bot,
        system: row.system,
        publicFlags: row.publicFlags,
        lastSeenAt: row.lastSeenAt,
      },
    });
}

export async function upsertThread(thread: ThreadChannel): Promise<void> {
  // Only persist `owner_id` if we successfully wrote the user row,
  // otherwise the FK constraint would reject the thread insert.
  let ownerIdForFk: string | null = null;
  if (thread.ownerId) {
    const owner = await thread.fetchOwner().catch(() => null);
    if (owner?.user) {
      try {
        await upsertUser(owner.user);
        ownerIdForFk = thread.ownerId;
      } catch {
        ownerIdForFk = null;
      }
    }
  }

  const row: NewThread = {
    id: thread.id,
    channelId: thread.parentId!,
    ownerId: ownerIdForFk,
    name: thread.name,
    archived: thread.archived ?? false,
    locked: thread.locked ?? false,
    invitable: thread.invitable ?? null,
    autoArchiveDuration:
      typeof thread.autoArchiveDuration === "number"
        ? thread.autoArchiveDuration
        : null,
    rateLimitPerUser: thread.rateLimitPerUser ?? null,
    messageCount: thread.messageCount ?? 0,
    totalMessageSent: thread.totalMessageSent ?? 0,
    memberCount: thread.memberCount ?? 0,
    flags: thread.flags?.bitfield ?? 0,
    type: thread.type,
    archivedAt: thread.archivedAt ?? null,
    lastMessageId: thread.lastMessageId ?? null,
    createdAt: thread.createdAt ?? new Date(),
    scrapedAt: new Date(),
  };
  await db
    .insert(threads)
    .values(row)
    .onConflictDoUpdate({
      target: threads.id,
      set: {
        ownerId: row.ownerId,
        name: row.name,
        archived: row.archived,
        locked: row.locked,
        invitable: row.invitable,
        autoArchiveDuration: row.autoArchiveDuration,
        rateLimitPerUser: row.rateLimitPerUser,
        messageCount: row.messageCount,
        totalMessageSent: row.totalMessageSent,
        memberCount: row.memberCount,
        flags: row.flags,
        archivedAt: row.archivedAt,
        lastMessageId: row.lastMessageId,
        scrapedAt: row.scrapedAt,
      },
    });

  await db
    .delete(threadAppliedTags)
    .where(sql`${threadAppliedTags.threadId} = ${thread.id}`);
  if (thread.appliedTags.length > 0) {
    await db
      .insert(threadAppliedTags)
      .values(thread.appliedTags.map((tagId) => ({ threadId: thread.id, tagId })))
      .onConflictDoNothing();
  }
}

export async function upsertMessage(message: Message<true>): Promise<void> {
  if (!isAuthorTracked(message.author?.id)) return;

  // Only persist `author_id` if we successfully wrote the user row,
  // mirroring the FK-safety logic in upsertThread.
  let authorIdForFk: string | null = null;
  if (message.author) {
    try {
      await upsertUser(message.author);
      authorIdForFk = message.author.id;
    } catch {
      authorIdForFk = null;
    }
  }

  const channel = message.channel;
  const isThread = channel.isThread();
  const channelId = isThread ? (channel.parentId ?? message.channelId) : message.channelId;
  const threadId = isThread ? message.channelId : null;

  const row: NewMessage = {
    id: message.id,
    channelId,
    threadId,
    authorId: authorIdForFk,
    content: message.content,
    type: message.type,
    flags: message.flags.bitfield,
    pinned: message.pinned,
    tts: message.tts,
    mentionEveryone: message.mentions.everyone,
    referencedMessageId: message.reference?.messageId ?? null,
    referencedChannelId: message.reference?.channelId ?? null,
    referencedGuildId: message.reference?.guildId ?? null,
    referenceType: message.reference?.type ?? null,
    messageSnapshots: extractSnapshots(message),
    webhookId: message.webhookId ?? null,
    applicationId: message.applicationId ?? null,
    embeds: message.embeds.map((embed) => embed.toJSON()),
    mentionedUserIds: message.mentions.users.map((user) => user.id),
    mentionedRoleIds: message.mentions.roles.map((role) => role.id),
    stickers: message.stickers.map((sticker) => sticker.toJSON()),
    components: message.components.map((component) => component.toJSON()),
    rawPayload: message.toJSON(),
    createdAt: message.createdAt,
    editedAt: message.editedAt ?? null,
    scrapedAt: new Date(),
  };
  await db
    .insert(messages)
    .values(row)
    .onConflictDoUpdate({
      target: messages.id,
      set: {
        content: row.content,
        flags: row.flags,
        pinned: row.pinned,
        embeds: row.embeds,
        mentionedUserIds: row.mentionedUserIds,
        mentionedRoleIds: row.mentionedRoleIds,
        stickers: row.stickers,
        components: row.components,
        messageSnapshots: row.messageSnapshots,
        referenceType: row.referenceType,
        editedAt: row.editedAt,
        scrapedAt: row.scrapedAt,
      },
    });

  if (message.attachments.size > 0) {
    const attachmentRows: NewAttachment[] = message.attachments.map((att) => ({
      id: att.id,
      messageId: message.id,
      filename: att.name,
      title: att.title ?? null,
      description: att.description ?? null,
      contentType: att.contentType ?? null,
      size: att.size,
      url: att.url,
      proxyUrl: att.proxyURL,
      width: att.width ?? null,
      height: att.height ?? null,
      durationSecs: att.duration ?? null,
      waveform: att.waveform ?? null,
      ephemeral: att.ephemeral,
      flags: att.flags.bitfield,
    }));
    await db
      .insert(attachments)
      .values(attachmentRows)
      .onConflictDoUpdate({
        target: attachments.id,
        set: {
          filename: sql`excluded.filename`,
          contentType: sql`excluded.content_type`,
          size: sql`excluded.size`,
          url: sql`excluded.url`,
          proxyUrl: sql`excluded.proxy_url`,
        },
      });
  }

  if (message.reactions.cache.size > 0) {
    const reactionRows: NewReaction[] = message.reactions.cache.map((reaction) => {
      const emojiId = reaction.emoji.id;
      const emojiName = reaction.emoji.name;
      const emojiKey = emojiId ?? emojiName ?? "unknown";
      return {
        messageId: message.id,
        emojiKey,
        emojiId,
        emojiName,
        animated: reaction.emoji.animated ?? false,
        count: reaction.count,
        burstCount: reaction.countDetails.burst,
        me: reaction.me,
      };
    });
    await db
      .insert(reactions)
      .values(reactionRows)
      .onConflictDoUpdate({
        target: [reactions.messageId, reactions.emojiKey],
        set: {
          count: sql`excluded.count`,
          burstCount: sql`excluded.burst_count`,
          me: sql`excluded.me`,
        },
      });
  }
}

/**
 * discord.js wraps message snapshots in a partial-Message class whose
 * `toJSON()` only re-emits the fields it chose to hydrate — and on
 * v14 it leaves `content`, `attachments` and `components` null even
 * when the API returned them. We sidestep that by reaching for the
 * underlying `_data` (the raw API payload) when present, and falling
 * back to `toJSON()` otherwise.
 */
function extractSnapshots(message: Message<true>): unknown[] {
  if (!message.messageSnapshots || message.messageSnapshots.size === 0) {
    return [];
  }
  return [...message.messageSnapshots.values()].map((snap) => {
    const raw = (snap as unknown as { _data?: unknown })._data;
    if (raw) return raw;
    if (typeof (snap as { toJSON?: () => unknown }).toJSON === "function") {
      return (snap as { toJSON: () => unknown }).toJSON();
    }
    return snap;
  });
}

export async function markMessageDeleted(messageId: string): Promise<void> {
  await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(sql`${messages.id} = ${messageId}`);
}

export async function markThreadDeleted(threadId: string): Promise<void> {
  await db
    .update(threads)
    .set({ deletedAt: new Date() })
    .where(sql`${threads.id} = ${threadId}`);
}
