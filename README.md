# ninshubur

A Discord channel scraper bot. Listens to channel + thread events on configured channels (text, announcement, voice-with-text, forum, media) and persists every message to PostgreSQL via Drizzle ORM.

Named after the Sumerian goddess Ninshubur, faithful messenger of Inanna. ✨

## Stack

- **Runtime**: Node.js 22, TypeScript (ESM, native `.ts` resolution via `tsx`)
- **Bot**: discord.js v14
- **Database**: PostgreSQL 16
- **ORM**: Drizzle + drizzle-zod
- **Validation**: Zod
- **CLI**: commander
- **Tests**: Vitest
- **Package manager**: pnpm
- **Deployment**: Docker Swarm (`compose.yml`)

## Layout

```
src/
  config.ts            # zod-validated env loader (dotenv-loaded)
  logger.ts            # pino logger
  index.ts             # entrypoint, hands off to cli.ts
  cli.ts               # commander program: start | backfill | migrate | channels | health
  bot/
    client.ts          # Discord client factory
    intents.ts         # gateway intents + partials
    filters.ts         # guild/channel allowlist helpers + channel type predicates
    events/            # one file per event handler
  db/
    index.ts           # drizzle pool + database
    schema/            # one file per table
    validators.ts      # drizzle-zod insert/select schemas
  scraper/
    channels.ts        # backfillChannel dispatcher + forum/text/thread strategies
    store.ts           # upsert helpers
drizzle/migrations     # generated SQL migrations
tests/                 # vitest suites
```

## Schema highlights

The Drizzle schema is generalized — any text-bearing channel works:

- `guilds` ← we joined this server
- `channels` ← any channel we track (Text, Announcement, Voice, Forum, Media); the `type` column is the discord.js `ChannelType` enum value
- `forum_tags` ← tags configured on a forum / media channel
- `threads` ← any thread (forum post or thread spawned from a text channel)
- `thread_applied_tags` ← M2M between forum-post threads and tags
- `users` ← any user we have observed
- `messages` ← messages with `channel_id` (always set) and an optional `thread_id` (set when the message lives inside a thread)
- `attachments` ← file attachments
- `reactions` ← per-emoji aggregate counts (composite PK on `message_id` + `emoji_key`)
- `scrape_state` ← `(scope_id, scope_type)` cursor — `scope_type` is `"channel"` or `"thread"`

Snowflakes are stored as `varchar(20)` to preserve precision (Discord IDs are 64-bit).

## CLI

```
ninshubur [--log-level <level>] <command>

  start [--no-backfill]              run the bot daemon (default)
  backfill [-g | -c | -t <id>]       one-off backfill, scoped to a guild / channel / thread
  channels [-g <id>] [--all] [--json]  list every channel the bot can see
  migrate [--folder <path>]          apply pending Drizzle migrations
  health                             probe Postgres + Discord and exit non-zero on failure
```

## Setup

```sh
# 1. Install deps
pnpm install

# 2. Copy and fill in env (DISCORD_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL)
cp .env.example .env

# 3. Boot a local Postgres (or use an existing one)
docker compose -f compose.dev.yml up -d

# 4. Apply migrations
pnpm cli migrate

# 5. List what the bot can see, then pick the channels you want
pnpm cli channels

# 6. Set CHANNEL_IDS in .env (comma-separated) — text and forum channels both work

# 7. Run the bot
pnpm dev
```

## Tests

```sh
pnpm test
```

## Deploying to Swarm

```sh
# Create the secrets once
printf '%s' "$DISCORD_TOKEN"  | docker secret create ninshubur_discord_token -
printf '%s' "$DATABASE_URL"   | docker secret create ninshubur_database_url -
printf '%s' "$PG_PASSWORD"    | docker secret create ninshubur_postgres_password -

# Build + deploy
docker build -t ninshubur:latest .
docker stack deploy -c compose.yml ninshubur
```

## Required Discord intents

The bot enables `MessageContent` (privileged) and `GuildMessageReactions`. Toggle both in the Developer Portal under **Bot → Privileged Gateway Intents** before inviting.

Invite URL template:

```
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&permissions=274877959168&scope=bot
```

The permission integer above grants: View Channels, Read Message History, Send Messages in Threads.
