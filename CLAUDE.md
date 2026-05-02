# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Ninshubur is a Discord scraper bot. It listens to the gateway for `messageCreate`/`messageUpdate`/`messageDelete`/`threadCreate`/`threadUpdate`/`threadDelete` events on configured channels and persists everything to PostgreSQL via Drizzle ORM. It also runs one-off backfills via REST. Named after the Sumerian goddess Ninshubur, faithful messenger of Inanna.

## Toolchain

- **Runtime**: Node.js ≥22, TypeScript with native `.ts` resolution via `tsx`. There is no compile step in the run path — `pnpm start` and `pnpm dev` execute `.ts` files directly. `tsc -p tsconfig.build.json` produces `dist/` only when needed.
- **Package manager**: `pnpm` (9.15.0). Do not switch to npm/yarn.
- **Imports**: Always use `.ts` extensions in relative imports (e.g. `import { foo } from "./bar.ts";`). The tsconfig has `allowImportingTsExtensions: true` and `verbatimModuleSyntax: true`.

## Common commands

```sh
pnpm install
pnpm typecheck                       # tsc --noEmit (also wired as `pnpm lint`)
pnpm test                            # vitest run
pnpm test -- tests/cli.test.ts       # single file
pnpm test -- -t "exposes the expected"   # single test by name
pnpm dev                             # tsx watch src/index.ts (default = `start`)

# CLI (preferred entrypoint — every operation is a subcommand of `pnpm cli`)
pnpm cli --help
pnpm cli start [--no-backfill]
pnpm cli backfill [-g <id>] [-c <id>] [-t <id>] [--reset]
pnpm cli channels [-g <id>] [--all] [--json]
pnpm cli migrate [--folder <path>]
pnpm cli reset --yes                 # DROP SCHEMA public + drizzle CASCADE + re-migrate
pnpm cli health
pnpm cli query <messages|wordcount|replies|daily|mentions> -c <channel-id> [...]

# Drizzle migrations
pnpm db:generate                     # drizzle-kit generate from schema diff
pnpm db:migrate                      # equivalent to `pnpm cli migrate`
pnpm db:studio                       # drizzle browser
```

`drizzle.config.ts` reads `DATABASE_URL` directly from `process.env` (not via `src/config.ts`) so that `drizzle-kit` does not need the full bot env.

## Architecture

### Layered modules

```
config.ts ← env (zod-validated, dotenv-loaded; throws on bad config)
  ↑
logger.ts ← pino, level from env
  ↑
db/        ← drizzle pool + schema/* + drizzle-zod validators
  ↑
bot/       ← Discord client, intents, gateway event handlers, allowlist filters
scraper/   ← upsert helpers (store.ts) and pagination strategies (channels.ts)
  ↑
cli.ts + cli/queries.ts ← commander program; the only public entrypoint
index.ts   ← `runCli(process.argv)`
```

`src/cli.ts::buildProgram()` registers every subcommand. `src/index.ts` is a one-line shim that calls `runCli`.

### Generalized channel model

Earlier versions tracked only forum channels. The current schema is generalized: the `channels` table holds **any** channel type (the `type` column is the discord.js `ChannelType` enum value). Forum-specific fields (`default_*`, applied tags) are nullable and only populated for `GuildForum`/`GuildMedia`. `messages.thread_id` is **nullable** — set only when a message lives inside a thread; `messages.channel_id` is always the parent channel.

`scrape_state` is keyed by `scope_id` with a `scope_type` discriminator (`"channel"` or `"thread"`) — same table tracks cursors for both text-channel and thread scrapes.

### Pagination model (critical)

Discord REST `GET /channels/{id}/messages` only returns messages **newest-first**. `src/scraper/channels.ts::walkAndPersist` switches strategy based on cursor presence:

- **No cursor (fresh backfill)** → walk **backward** with `before:` until the channel is exhausted.
- **Cursor present (incremental)** → walk **forward** with `after:` from the cursor.

The cursor is set to the *newest* observed id at the end of either walk so future runs can do incremental top-ups. **Always advance `newestId` even for filtered-out messages** — otherwise the cursor would never move past the head of a channel where every recent message fails the `USER_IDS` filter.

### Filters and allowlists

`src/bot/filters.ts` is the single source of truth for "should we touch this?":

- `isTrackedGuild(guildId)` — empty `DISCORD_GUILD_IDS` means all guilds.
- `isTrackedChannel(channel)` — channel must be scrapable type, in a tracked guild, and (if `CHANNEL_IDS` is non-empty) in the allowlist.
- `isAuthorTracked(authorId)` — empty `USER_IDS` means everyone; otherwise only listed authors are persisted. Applied inside `upsertMessage` and the backfill loop (the loop short-circuits the upsert work but still advances the cursor).
- `canReadChannel(channel, client)` — runtime permission pre-check using `PermissionsBitField.Flags.ViewChannel | ReadMessageHistory`.

`isScrapableChannel` distinguishes `TEXT_LIKE_CHANNEL_TYPES` (Text, Announcement, Voice, StageVoice — direct messages) from `FORUM_LIKE_CHANNEL_TYPES` (Forum, Media — container of threads). The `backfillChannel` dispatcher in `src/scraper/channels.ts` picks the strategy based on this.

### Resilience contract

Backfill must survive both bad data and bad permissions. `walkAndPersist` and `runBackfill` cooperate:

- Per-message: `upsertMessage` exceptions are caught inside `walkAndPersist`'s `visit()` so one rogue message does not kill the channel walk. The cursor still advances past it.
- Per-page: REST errors `50001` (Missing Access), `50013` (Missing Permissions), `10003` (Unknown Channel), `10008` (Unknown Message) inside `walkAndPersist` are downgraded to a warn-and-stop for that scope.
- Per-channel: `runBackfill`'s multi-channel loop wraps each `backfillChannel` so one failure does not abort a sweep across many channels.

### FK safety in upserts

`upsertThread` and `upsertMessage` only write `owner_id` / `author_id` after successfully upserting the corresponding `users` row. If the user fetch fails (deleted account, ToS-banned, etc.), the FK column is set to `null` instead of triggering a constraint violation.

### Forwarded messages (HAS_SNAPSHOT)

When `message.flags & (1<<14)` is set, the visible message is a forward and the real content lives in `message.messageSnapshots`. discord.js's public wrapper (`snap.toJSON()`) leaves `content`/`components`/`attachments` null for snapshots — `extractSnapshots()` in `src/scraper/store.ts` reaches into the wrapper's private `_data` to recover the API payload. Stored shape is the unwrapped message data array (no `{ message: ... }` wrapper).

### Discord intents

`src/bot/intents.ts`: `Guilds`, `GuildMessages`, `MessageContent` (privileged — must be enabled in Developer Portal), `GuildMessageReactions`. Partials are enabled for `Channel`, `Message`, `Reaction`, `ThreadMember` so events for un-cached objects still fire.

### `Events.ClientReady`, not `"ready"`

The string `"ready"` triggers a v14.26 deprecation warning. Use the `Events.ClientReady` enum. The shared helper is `cli.ts::waitUntilReady(client)`.

## Testing

Vitest runs against `tests/**/*.test.ts`. Tests that touch modules with side-effectful imports (e.g. `config.ts` parsing env, `db/index.ts` opening a pool) use `vi.mock("../src/config.ts", ...)` and `vi.mock("../src/db/index.ts", ...)` to stub them — see `tests/cli.test.ts` for the pattern. There is no live-DB integration test; `pnpm cli health` is the manual smoke test.

## Schema changes

1. Edit files under `src/db/schema/`.
2. `pnpm db:generate` to produce a new SQL migration in `drizzle/migrations/`.
3. `pnpm cli migrate` to apply.
4. For dev wipes: `pnpm cli reset --yes` drops both `public` and `drizzle` schemas and re-migrates. The `drizzle` schema drop is required — drizzle-kit tracks applied migrations there, and skipping it would make the next `migrate` think everything is already applied.

`tsconfig.json` does NOT enable `exactOptionalPropertyTypes` — Drizzle's `set:` clause types fight it. Leave it off.

## Operations

- Local Postgres expected at `postgres://postgres:postgres@localhost:5432/ninshubur` (see `compose.dev.yml`).
- Production deploy is Docker Swarm via `compose.yml`; secrets come from `docker secret create ninshubur_*`. The runtime image runs `pnpm start` (i.e. `tsx`) — there is no compiled `dist` shipped.
