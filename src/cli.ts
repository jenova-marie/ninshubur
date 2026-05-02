import { Command, Option } from "commander";
import {
  ChannelType,
  Events,
  type Client,
  type Guild,
  type GuildBasedChannel,
} from "discord.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { inArray, sql } from "drizzle-orm";
import { scrapeState, threads } from "./db/schema/index.ts";
import { startBot, createClient } from "./bot/client.ts";
import { isTrackedChannel, isTrackedGuild } from "./bot/filters.ts";
import { env } from "./config.ts";
import { db, pool } from "./db/index.ts";
import { logger } from "./logger.ts";
import { backfillChannel, backfillThread } from "./scraper/channels.ts";
import { upsertChannel, upsertGuild } from "./scraper/store.ts";
import { registerQueryCommand } from "./cli/queries.ts";
import { registerAnalyzeCommand } from "./cli/analyze.ts";
import { registerRagCommand } from "./cli/rag.ts";

const VERSION = "0.1.0";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("ninshubur")
    .description("Discord channel scraper bot — Ninshubur, faithful messenger ✨")
    .version(VERSION)
    .addOption(
      new Option("--log-level <level>", "override LOG_LEVEL for this run")
        .choices(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
    )
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts<{ logLevel?: string }>();
      if (opts.logLevel) logger.level = opts.logLevel;
    });

  program
    .command("start", { isDefault: true })
    .description("Login as the bot and listen for channel events")
    .option("--no-backfill", "Skip the initial channel/thread backfill on ready")
    .action(async (opts: { backfill: boolean }) => {
      await runStart({ backfillOnReady: opts.backfill });
    });

  program
    .command("backfill")
    .description(
      "Run a one-off backfill against any channel (forum or text) or a single thread",
    )
    .option("-g, --guild <id>", "Restrict to a specific guild id")
    .option("-c, --channel <id>", "Backfill only this channel")
    .option("-t, --thread <id>", "Backfill only this thread")
    .option(
      "--reset",
      "Clear the scrape cursor before backfilling so messages are re-fetched from the start (dev/testing)",
    )
    .action(
      async (opts: {
        guild?: string;
        channel?: string;
        thread?: string;
        reset?: boolean;
      }) => {
        await runBackfill(opts);
      },
    );

  program
    .command("migrate")
    .description("Apply pending Drizzle migrations against DATABASE_URL")
    .option(
      "--folder <path>",
      "Path to the migrations folder",
      "./drizzle/migrations",
    )
    .action(async (opts: { folder: string }) => {
      await runMigrate(opts.folder);
    });

  program
    .command("reset")
    .description(
      "DEV ONLY: drop the entire database schema and re-run migrations — wipes ALL data",
    )
    .option("--yes", "Confirm the wipe (required)")
    .option(
      "--folder <path>",
      "Path to the migrations folder",
      "./drizzle/migrations",
    )
    .action(async (opts: { yes?: boolean; folder: string }) => {
      await runReset(opts);
    });

  program
    .command("channels")
    .description("List every channel the bot can see, grouped by guild")
    .option("-g, --guild <id>", "Restrict to a specific guild id")
    .option(
      "--all",
      "Show every joined guild, ignoring the DISCORD_GUILD_IDS allowlist",
    )
    .option("--json", "Emit JSON instead of a formatted tree")
    .action(
      async (opts: { guild?: string; all?: boolean; json?: boolean }) => {
        await runListChannels(opts);
      },
    );

  program
    .command("health")
    .description("Check Postgres + Discord connectivity and exit")
    .action(async () => {
      await runHealth();
    });

  registerQueryCommand(program);
  registerAnalyzeCommand(program);
  registerRagCommand(program);

  return program;
}

/**
 * Resolve once the gateway has fired ClientReady.
 *
 * We use the `Events.ClientReady` enum rather than the string "ready"
 * because discord.js v14.26 emits a deprecation warning for the
 * "ready" name (it becomes "clientReady"-only in v15).
 */
function waitUntilReady(client: Client): Promise<void> {
  return new Promise((resolve) => client.once(Events.ClientReady, () => resolve()));
}

async function runStart(options: { backfillOnReady: boolean }): Promise<void> {
  const client = await startBot({ backfillOnReady: options.backfillOnReady });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, "shutting down");
    try {
      await client.destroy();
      await pool.end();
    } catch (err) {
      logger.error({ err }, "error during shutdown");
    }
    process.exit(0);
  };

  process.once("SIGINT", (sig) => void shutdown(sig));
  process.once("SIGTERM", (sig) => void shutdown(sig));
}

async function runBackfill(opts: {
  guild?: string;
  channel?: string;
  thread?: string;
  reset?: boolean;
}): Promise<void> {
  const client = createClient({ backfillOnReady: false });
  await client.login(env.DISCORD_TOKEN);

  await waitUntilReady(client);

  try {
    if (opts.thread) {
      const thread = await client.channels.fetch(opts.thread);
      if (!thread || !thread.isThread()) {
        throw new Error(`channel ${opts.thread} is not a thread`);
      }
      if (opts.reset) await resetCursors([thread.id]);
      await backfillThread(thread);
      return;
    }

    if (opts.channel) {
      const channel = await client.channels.fetch(opts.channel);
      if (!channel || channel.isDMBased()) {
        throw new Error(`channel ${opts.channel} not found or is a DM`);
      }
      const guildChannel = channel as GuildBasedChannel;
      if (opts.reset) await resetChannelCursors(channel.id);
      await upsertGuild(guildChannel.guild);
      await backfillChannel(guildChannel);
      return;
    }

    for (const [, guild] of client.guilds.cache) {
      if (opts.guild && guild.id !== opts.guild) continue;
      await upsertGuild(guild);
      const channels = await guild.channels.fetch();
      for (const [, channel] of channels) {
        if (!channel) continue;
        const guildChannel = channel as GuildBasedChannel;
        if (!isTrackedChannel(guildChannel)) continue;
        if (opts.reset) await resetChannelCursors(channel.id);
        try {
          await backfillChannel(guildChannel);
        } catch (err) {
          // Don't let one bad channel kill a 60-channel sweep.
          logger.error(
            { err, channelId: channel.id, name: channel.name },
            "channel backfill failed — moving on",
          );
        }
      }
    }
  } finally {
    await client.destroy();
    await pool.end();
  }
}

/**
 * Clear the scrape cursor for the given scope ids so the next backfill
 * pages from message zero again. Threads under a channel scope are
 * also cleared so a forum re-scrape doesn't leave stale per-thread
 * cursors.
 */
async function resetCursors(scopeIds: string[]): Promise<void> {
  if (scopeIds.length === 0) return;
  const result = await db
    .delete(scrapeState)
    .where(inArray(scrapeState.scopeId, scopeIds))
    .returning({ scopeId: scrapeState.scopeId });
  logger.info(
    { cleared: result.length, scopeIds },
    "scrape cursors reset",
  );
}

async function resetChannelCursors(channelId: string): Promise<void> {
  const childThreads = await db
    .select({ id: threads.id })
    .from(threads)
    .where(sql`${threads.channelId} = ${channelId}`);
  await resetCursors([channelId, ...childThreads.map((t) => t.id)]);
}

async function runMigrate(folder: string): Promise<void> {
  logger.info({ folder }, "running migrations");
  try {
    await migrate(db, { migrationsFolder: folder });
    logger.info("migrations applied");
  } finally {
    await pool.end();
  }
}

async function runReset(opts: { yes?: boolean; folder: string }): Promise<void> {
  if (!opts.yes) {
    process.stderr.write(
      "Refusing to reset without --yes.\n" +
        "  This will DROP every ninshubur table and re-run migrations from scratch.\n" +
        "  Re-run as: pnpm cli reset --yes\n",
    );
    process.exit(2);
  }
  if (env.NODE_ENV === "production") {
    process.stderr.write(
      "Refusing to reset while NODE_ENV=production. Set NODE_ENV=development first.\n",
    );
    process.exit(2);
  }

  try {
    logger.warn({ databaseUrl: env.DATABASE_URL }, "dropping schemas");
    // drizzle-orm tracks migration history in a separate `drizzle`
    // schema (table __drizzle_migrations); we drop both so the next
    // migrate() actually re-applies everything.
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`DROP SCHEMA public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    logger.info({ folder: opts.folder }, "re-running migrations");
    await migrate(db, { migrationsFolder: opts.folder });
    logger.info("reset complete — database is empty and at schema HEAD");
  } finally {
    await pool.end();
  }
}

interface ChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  typeLabel: string;
  parentId: string | null;
  position: number;
  nsfw: boolean;
  tracked: boolean;
}

interface GuildReport {
  id: string;
  name: string;
  memberCount: number;
  channelCount: number;
  channels: ChannelRow[];
}

const CHANNEL_TYPE_LABELS: Record<number, string> = {
  [ChannelType.GuildText]: "Text",
  [ChannelType.DM]: "DM",
  [ChannelType.GuildVoice]: "Voice",
  [ChannelType.GroupDM]: "GroupDM",
  [ChannelType.GuildCategory]: "Category",
  [ChannelType.GuildAnnouncement]: "Announcement",
  [ChannelType.AnnouncementThread]: "AnnouncementThread",
  [ChannelType.PublicThread]: "PublicThread",
  [ChannelType.PrivateThread]: "PrivateThread",
  [ChannelType.GuildStageVoice]: "Stage",
  [ChannelType.GuildDirectory]: "Directory",
  [ChannelType.GuildForum]: "Forum",
  [ChannelType.GuildMedia]: "Media",
};

function describeChannel(channel: GuildBasedChannel): ChannelRow {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    typeLabel: CHANNEL_TYPE_LABELS[channel.type] ?? `Type${channel.type}`,
    parentId: channel.parentId,
    position: "position" in channel ? (channel.position ?? 0) : 0,
    nsfw: "nsfw" in channel ? Boolean(channel.nsfw) : false,
    tracked: isTrackedChannel(channel),
  };
}

async function collectGuildReport(
  guild: Guild,
  filter: (channel: GuildBasedChannel) => boolean = () => true,
): Promise<GuildReport> {
  const channels = await guild.channels.fetch();
  const rows: ChannelRow[] = [];
  for (const [, channel] of channels) {
    if (!channel) continue;
    if (!filter(channel)) continue;
    rows.push(describeChannel(channel));
  }
  rows.sort((a, b) => {
    if (a.parentId === b.parentId) return a.position - b.position;
    if (a.parentId === null) return -1;
    if (b.parentId === null) return 1;
    return a.parentId.localeCompare(b.parentId);
  });
  return {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    channelCount: rows.length,
    channels: rows,
  };
}

function renderGuildReport(report: GuildReport): string {
  const lines: string[] = [];
  lines.push(`📡 ${report.name}  (${report.id})`);
  lines.push(
    `   ${report.channelCount} channels · ${report.memberCount} members`,
  );

  const byParent = new Map<string | null, ChannelRow[]>();
  for (const row of report.channels) {
    const key = row.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }

  const printed = new Set<string>();
  const formatRow = (row: ChannelRow, indent: string): string => {
    const tracked = row.tracked ? " ⭐" : "";
    const nsfw = row.nsfw ? " 🔞" : "";
    const typeBadge = `[${row.typeLabel}]`.padEnd(20);
    return `${indent}${typeBadge} ${row.id}  ${row.name}${tracked}${nsfw}`;
  };

  const topLevel = byParent.get(null) ?? [];
  for (const row of topLevel) {
    if (printed.has(row.id)) continue;
    printed.add(row.id);
    lines.push(formatRow(row, "   "));
    if (row.type === ChannelType.GuildCategory) {
      const children = byParent.get(row.id) ?? [];
      for (const child of children) {
        printed.add(child.id);
        lines.push(formatRow(child, "     ↳ "));
      }
    }
  }

  for (const row of report.channels) {
    if (printed.has(row.id)) continue;
    lines.push(formatRow(row, "   "));
  }

  return lines.join("\n");
}

async function runListChannels(opts: {
  guild?: string;
  all?: boolean;
  json?: boolean;
}): Promise<void> {
  const client = createClient({ backfillOnReady: false });
  try {
    await client.login(env.DISCORD_TOKEN);
    await waitUntilReady(client);

    const reports: GuildReport[] = [];
    for (const [, guild] of client.guilds.cache) {
      if (opts.guild && guild.id !== opts.guild) continue;
      if (!opts.all && !opts.guild && !isTrackedGuild(guild.id)) continue;
      reports.push(await collectGuildReport(guild));
    }

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    } else if (reports.length === 0) {
      process.stdout.write(
        "No matching guilds. The bot may not be invited yet, or DISCORD_GUILD_IDS does not include any joined guild. Try --all.\n",
      );
    } else {
      for (const report of reports) {
        process.stdout.write(`${renderGuildReport(report)}\n\n`);
      }
    }
  } finally {
    await client.destroy().catch(() => {});
    await pool.end().catch(() => {});
  }
}

async function runHealth(): Promise<void> {
  const report: Record<string, "ok" | string> = {};

  try {
    await db.execute(sql`select 1`);
    report.postgres = "ok";
  } catch (err) {
    report.postgres = err instanceof Error ? err.message : String(err);
  }

  const client = createClient({ backfillOnReady: false });
  try {
    await client.login(env.DISCORD_TOKEN);
    await waitUntilReady(client);
    report.discord = "ok";
    report.guilds = String(client.guilds.cache.size);
  } catch (err) {
    report.discord = err instanceof Error ? err.message : String(err);
  } finally {
    await client.destroy().catch(() => {});
    await pool.end().catch(() => {});
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const allOk = report.postgres === "ok" && report.discord === "ok";
  process.exit(allOk ? 0 : 1);
}

export async function runCli(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}
