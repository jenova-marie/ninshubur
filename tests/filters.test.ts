import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/config.ts", () => ({
  env: {
    DISCORD_TOKEN: "x",
    DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_IDS: ["111111111111111111"],
    CHANNEL_IDS: ["222222222222222222"],
    USER_IDS: [],
    DATABASE_URL: "postgres://localhost/x",
    BACKFILL_PAGE_SIZE: 100,
    ARCHIVE_SWEEP_INTERVAL_MS: 900000,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  },
}));

import { ChannelType } from "discord.js";

let isTrackedChannel: typeof import("../src/bot/filters.ts").isTrackedChannel;
let isTrackedGuild: typeof import("../src/bot/filters.ts").isTrackedGuild;
let isTextLikeChannel: typeof import("../src/bot/filters.ts").isTextLikeChannel;
let isForumLikeChannel: typeof import("../src/bot/filters.ts").isForumLikeChannel;

beforeEach(async () => {
  const mod = await import("../src/bot/filters.ts");
  isTrackedChannel = mod.isTrackedChannel;
  isTrackedGuild = mod.isTrackedGuild;
  isTextLikeChannel = mod.isTextLikeChannel;
  isForumLikeChannel = mod.isForumLikeChannel;
});

describe("isTrackedGuild", () => {
  it("accepts guilds in the allowlist", () => {
    expect(isTrackedGuild("111111111111111111")).toBe(true);
  });

  it("rejects guilds not in the allowlist", () => {
    expect(isTrackedGuild("999999999999999999")).toBe(false);
  });
});

describe("channel type predicates", () => {
  it("classifies text-like channels", () => {
    expect(isTextLikeChannel(ChannelType.GuildText)).toBe(true);
    expect(isTextLikeChannel(ChannelType.GuildAnnouncement)).toBe(true);
    expect(isTextLikeChannel(ChannelType.GuildVoice)).toBe(true);
    expect(isTextLikeChannel(ChannelType.GuildForum)).toBe(false);
  });

  it("classifies forum-like channels", () => {
    expect(isForumLikeChannel(ChannelType.GuildForum)).toBe(true);
    expect(isForumLikeChannel(ChannelType.GuildMedia)).toBe(true);
    expect(isForumLikeChannel(ChannelType.GuildText)).toBe(false);
  });
});

describe("isTrackedChannel", () => {
  it("rejects category channels", () => {
    const channel = {
      type: ChannelType.GuildCategory,
      guildId: "111111111111111111",
      id: "222222222222222222",
    } as never;
    expect(isTrackedChannel(channel)).toBe(false);
  });

  it("accepts forum channels in the allowlist", () => {
    const channel = {
      type: ChannelType.GuildForum,
      guildId: "111111111111111111",
      id: "222222222222222222",
    } as never;
    expect(isTrackedChannel(channel)).toBe(true);
  });

  it("accepts text channels in the allowlist", () => {
    const channel = {
      type: ChannelType.GuildText,
      guildId: "111111111111111111",
      id: "222222222222222222",
    } as never;
    expect(isTrackedChannel(channel)).toBe(true);
  });

  it("rejects channels outside the allowlist", () => {
    const channel = {
      type: ChannelType.GuildText,
      guildId: "111111111111111111",
      id: "333333333333333333",
    } as never;
    expect(isTrackedChannel(channel)).toBe(false);
  });

  it("rejects channels in untracked guilds", () => {
    const channel = {
      type: ChannelType.GuildText,
      guildId: "999999999999999999",
      id: "222222222222222222",
    } as never;
    expect(isTrackedChannel(channel)).toBe(false);
  });
});
