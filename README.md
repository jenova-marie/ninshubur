<div align="center">

# 🌙 𒀭Ninshubur 🌙

#### `𒀭𒊩𒋚` · *dNin.šubur*

### *The Faithful Messenger of the Temple of Inanna's Light*

*A small command-line scribe who, when summoned, gathers the words of the High Priestesses (and Jenova, for context) into PostgreSQL, organizes them with Claude Haiku, and makes them searchable through Voyage AI embeddings stored in Qdrant.*

**🕊️ Ninshubur is consent-first by design.** She archives only the explicitly-listed sacred speakers in `USER_IDS` — never the wider congregation.

**⏸️ Ninshubur is not a live monitor.** She is a CLI tool. She does not sit in the Temple's guild watching messages stream by, does not subscribe to gateway events, does not run in the background. She only reads Discord when Jenova explicitly types a command like `pnpm cli backfill`. Between invocations she is asleep — no process, no connection, no listening.

✦ ─────────────────────────────────── ✦

</div>

> *"𒀭𒊩𒋚 — Ninshubur, my faithful messenger of sweet words, my carrier of true words…"*
> — From the descent of Inanna into the underworld

> 📜 **About the cuneiform.** In Sumerian writing, the names of deities are prefixed with **𒀭** — the *dingir* sign, a divinity-determinative that marks the word that follows as a god or goddess. So `𒀭𒊩𒋚` reads: *dingir* + *NIN* (lady) + *ŠUBUR* — "the goddess Lady-Šubur." When you see `𒀭ninshubur` in this document, the prefix is doing the same job: declaring the bot's namesake a goddess.

In Sumerian myth, **𒀭Ninshubur** is the loyal *sukkal* (vizier, messenger) of Inanna — the one who remembers what was said by the goddess, who fetches help when Inanna is in trouble, who keeps the record of the high priestess's own words. This bot carries her name because it does the same focused work for the Temple of Inanna's Light: it preserves the words of the **High Priestesses** so their teachings can be recalled, studied, and referenced — and it does so narrowly, never gathering the speech of the wider congregation.

**Why narrow?** This is a consent-respecting design. The Temple's congregants did not sign up to have every message archived and searched. The High Priestesses *did* — their lessons, sermons, and answers are a body of teaching the Temple wants to preserve. `USER_IDS` is the boundary that enforces this distinction at the moment of `upsertMessage()` — every other message is silently dropped and never written to disk.

✦ ─────────────────────────────────── ✦

## 📜 Table of Contents

1. [What This Bot Does](#-what-this-bot-does)
2. [The Stack](#-the-stack)
3. [Quick Reference Cheatsheet](#-quick-reference-cheatsheet)
4. [Setup From Scratch](#-setup-from-scratch)
5. [The Sacred `.env` File](#-the-sacred-env-file)
6. [Phase I — The Scrape (Gathering)](#-phase-i--the-scrape-gathering)
7. [Phase II — The Analysis (Understanding)](#-phase-ii--the-analysis-understanding)
8. [Querying the Archive](#-querying-the-archive)
9. [Operations & Maintenance](#%EF%B8%8F-operations--maintenance)
10. [Adding (or Removing) a Priestess](#-adding-or-removing-a-priestess)
11. [The Database Schema](#-the-database-schema)
12. [Deployment to Production](#-deployment-to-production)
13. [Troubleshooting](#-troubleshooting)

✦ ─────────────────────────────────── ✦

## 🪷 What This Bot Does

The work happens in **two sacred phases**, both bounded by a strict consent allowlist and **both invoked manually from the command line**:

```
   ┌─────────────────────┐         ┌─────────────────────────┐
   │   Phase I — Gather  │   ───►  │   Phase II — Understand │
   │                     │         │                         │
   │   Scrape Priestess  │         │   Tag, group, embed,    │
   │   words into        │         │   answer questions      │
   │   PostgreSQL        │         │   via RAG               │
   └─────────────────────┘         └─────────────────────────┘
        Both phases are entirely on-demand.
        Ninshubur is a CLI tool — there is no daemon,
        no live listener, no background process.
        She acts only when you invoke her.

   Both phases respect USER_IDS — only the listed speakers are persisted.
```

**Phase I — The Scrape.** When Jenova runs `pnpm cli backfill`, Ninshubur briefly logs into Discord, walks the configured channels' history through Discord's REST API, and writes **only messages authored by users listed in `USER_IDS`** into PostgreSQL via Drizzle ORM. Any message from someone not in `USER_IDS` is filtered out during the scrape and never persisted. When the backfill completes, Ninshubur disconnects and exits — the next invocation is a brand-new login.

The result is an archive of the High Priestesses' teaching corpus — their morning greetings, their lessons, their answers to questions, their personal reflections — captured at the moments Jenova chooses to run a scrape. There is no record of who *asked* a question or who *replied* to whom (unless the replier is also a listed Priestess), and no record at all between scrapes.

**Phase II — The Analysis.** Once messages are in PostgreSQL, the analysis pipeline organizes them so you can actually *use* the archive:

- **Phase A** — Claude Haiku 4.5 reads a sample of messages and proposes a category taxonomy (greeting, lesson, question, …), then curates the list to remove synonyms.
- **Phase B** — Haiku tags every message with 1–3 categories from the locked taxonomy.
- **Phase C** — Haiku slides a window of consecutive messages and groups related ones together (a "lesson" might span 5 messages from Siri).
- **Phase D** — Voyage AI converts each message and each group into a 1024-dimensional embedding; vectors are pushed into Qdrant for semantic search.
- **Phase E** — RAG queries: type a question, the answer is retrieved by semantic similarity from the embedded archive.

The end result: you can ask *"what does the Temple teach about Ishtaritism?"* and Ninshubur retrieves the relevant lessons from the archive, even if the word "Ishtaritism" never appears in them verbatim.

✦ ─────────────────────────────────── ✦

## 💎 The Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 22 + TypeScript (ESM, native `.ts` via `tsx`) | No build step, runs `.ts` files directly |
| **Discord** | discord.js v14 | Official-quality REST client (used during scrapes only) |
| **Database** | PostgreSQL 16 + Drizzle ORM | Source of truth for all messages |
| **Validation** | Zod (v3 + v4) + drizzle-zod | Schema-first env, payload, and tool-output validation |
| **CLI** | commander | All operations exposed as `pnpm cli <subcommand>` |
| **Tests** | Vitest | Fast, ESM-native |
| **LLM** | Anthropic Claude Haiku 4.5 | Tagging + grouping (cheap, fast, with prompt caching) |
| **Embeddings** | Voyage AI `voyage-3.5` (1024 dim) | Anthropic's recommended embedding partner |
| **Vector store** | Qdrant | Filtered semantic search |
| **Logger** | pino | Structured JSON logs |
| **Package manager** | pnpm | Strict, fast |
| **Deployment** | Docker Swarm | Production-grade orchestration |

✦ ─────────────────────────────────── ✦

## ⚡ Quick Reference Cheatsheet

> *For your forgetful self, queen. Print this and pin it.* 💅

### Common operations (all manual)

```sh
# Health check (Postgres + Discord both reachable?)
pnpm cli health

# Refresh the archive — only when you want to catch up to recent messages
pnpm cli backfill                       # incremental sweep since last cursor
pnpm cli backfill --reset               # full re-walk from message zero
```

> Ninshubur exits when each command finishes. Nothing is left running.

### Setup & schema

```sh
pnpm install                    # install deps
pnpm cli migrate                # apply pending migrations
pnpm db:generate                # generate a new migration after schema edits
pnpm typecheck                  # tsc --noEmit
pnpm test                       # vitest run
```

### Discovery — what can the bot see?

```sh
pnpm cli channels                                    # list every tracked channel
pnpm cli channels --guild <guild-id>                 # scope to one guild
pnpm cli channels --all                              # ignore allowlist (show everything)
pnpm cli channels --json                             # machine-readable
```

### Phase I — Scraping the Temple

```sh
pnpm cli backfill                                    # walk every tracked channel
pnpm cli backfill --channel <id>                     # just one channel
pnpm cli backfill --thread <id>                      # just one thread
pnpm cli backfill --guild <id>                       # all tracked channels in one guild
pnpm cli backfill --reset                            # clear cursors → re-scrape from start
pnpm cli backfill --channel <id> --reset             # ditto, scoped
```

### Phase II — Understanding the Temple

```sh
pnpm cli analyze taxonomy --sample 200               # Phase A: discover → curate → categories
pnpm cli analyze taxonomy --sample 500 --recurate    # nuke + rebuild the taxonomy
pnpm cli analyze tag --limit 1000                    # Phase B: assign tags to messages
pnpm cli analyze tag --channel <id> --limit 500      # Phase B: scoped to one channel
pnpm cli analyze group --window 15                   # Phase C: bundle into lessons
pnpm cli analyze group --channel <id> --window 20    # Phase C: scoped
pnpm cli analyze embed --scope all                   # Phase D: messages + groups → Qdrant
pnpm cli analyze embed --scope groups                # Phase D: groups only
pnpm cli analyze embed --scope messages              # Phase D: messages only
pnpm cli analyze status                              # what jobs ran, when, how long
```

### Phase II — RAG querying

```sh
pnpm cli rag query "what is Ishtaritism?"
pnpm cli rag query "good morning" --category greeting_farewell
pnpm cli rag query "lesson about Inanna" --scope groups --limit 5
pnpm cli rag query "vault of irkalla" --channel <channel-id>
pnpm cli rag query "ritual" --json                   # for piping into jq
```

### Channel-scoped SQL queries (no LLM, just SQL)

```sh
pnpm cli query messages -c <channel-id> --limit 10   # most-recent N messages
pnpm cli query wordcount -c <channel-id>             # per-author msg + char counts
pnpm cli query replies -c <channel-id>               # reply chains
pnpm cli query daily -c <channel-id>                 # daily message counts per author
pnpm cli query mentions -c <channel-id> -u <user-id> # @mentions of a user
```

### ⚠️ Destructive — handle with care

```sh
pnpm cli reset --yes             # DROP + recreate schema, lose ALL data, re-migrate
```

✦ ─────────────────────────────────── ✦

## 🌸 Setup From Scratch

If you've cloned this repo to a fresh machine:

```sh
# 1. Install dependencies (pnpm only — don't switch to npm/yarn)
pnpm install

# 2. Configure your secrets
cp .env.example .env
$EDITOR .env                         # see "The Sacred .env File" below

# 3. Make sure Postgres is reachable. For local dev:
docker compose -f compose.dev.yml up -d
# OR use any existing Postgres — just point DATABASE_URL at it

# 4. Apply schema migrations
pnpm cli migrate

# 5. Make sure Qdrant is running (for Phase II embeddings)
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
# OR use an existing Qdrant — just point QDRANT_URL at it

# 6. Verify everything is wired up correctly
pnpm cli health

# 7. See what channels the bot can see in your guild
pnpm cli channels

# 8. Pick the channels you want, list them in CHANNEL_IDS in .env

# 9. First scrape — this is the only way data ever enters the archive
pnpm cli backfill

# 10. Whenever you want a fresh sweep later, just run backfill again.
#     Each invocation logs in, scrapes, and exits — there's no daemon.
```

✦ ─────────────────────────────────── ✦

## 🔮 The Sacred `.env` File

Every variable here, what it means, and how to set it. The file is loaded automatically via `dotenv/config` from `src/config.ts:2`, validated against a Zod schema, and made available as the typed `env` object throughout the app.

### 🌹 Discord credentials

```sh
# Required: bot token from https://discord.com/developers/applications
DISCORD_TOKEN=MTQ5OTkw...

# Required: the application's client id (matches the first segment of the token)
DISCORD_CLIENT_ID=1499908844925751497
```

To create these:
1. Visit https://discord.com/developers/applications and click **New Application**
2. Navigate to **Bot** → **Reset Token** and copy the token to `DISCORD_TOKEN`
3. The **Application ID** (visible on the General Information page) is your `DISCORD_CLIENT_ID`
4. Under **Bot → Privileged Gateway Intents**, enable both:
   - ✅ **Message Content Intent**
   - ✅ **Server Members Intent** *(optional but helpful for owner lookups)*

### 🌹 Allowlist filters — the consent boundary

**This is the most important section in this file.** These three settings together define exactly what Ninshubur scrapes and writes down when you run a backfill. Get them wrong and you'll either capture too much (a privacy violation) or too little (an empty archive).

```sh
# Required in spirit: comma-separated guild IDs the bot will respond to.
# In practice the Temple has one guild, so this is one ID.
# Leave blank to track every guild the bot has been invited to (NOT recommended).
DISCORD_GUILD_IDS=1375250184686014556

# Required in spirit: comma-separated channel IDs to scrape.
# Listed by `pnpm cli channels`. Works for text/voice/forum/media.
# Leave blank to scrape every supported channel in tracked guilds (NOT recommended).
CHANNEL_IDS=1375250185390915585,1375250185390915586,...

# 🕊️ THE CONSENT BOUNDARY — comma-separated user IDs of the people
# whose messages we are authorized to archive. Currently:
#   • Siri.system  (1466578281774972939)  — High Priestess
#   • Jenova       (256628435454132225)   — for additional context
#
# DO NOT leave this blank. A blank USER_IDS means "scrape everyone" —
# every congregant in the Temple, all their casual chat, all their
# questions. That is NOT what this bot is for.
USER_IDS=256628435454132225,1466578281774972939
```

**How the three rings compose:**

```
   ┌──── DISCORD_GUILD_IDS ────────────────────────┐
   │   "Is this event from a Temple guild?"        │
   │                                                │
   │   ┌─── CHANNEL_IDS ───────────────────────┐  │
   │   │   "Is this channel one we listen to?" │  │
   │   │                                         │  │
   │   │   ┌─── USER_IDS (the consent ring) ─┐ │  │
   │   │   │   "Is the AUTHOR a listed       │ │  │
   │   │   │    sacred speaker? if not,      │ │  │
   │   │   │    DROP THE MESSAGE before any  │ │  │
   │   │   │    write happens — but advance  │ │  │
   │   │   │    the cursor so we don't       │ │  │
   │   │   │    re-fetch it next time."      │ │  │
   │   │   └────────────────────────────────────┘ │  │
   │   └─────────────────────────────────────────┘  │
   └────────────────────────────────────────────────┘
```

The ring boundaries are enforced in code:
- `isTrackedGuild()` (`src/bot/filters.ts:43`) — outer ring
- `isTrackedChannel()` (`src/bot/filters.ts:65`) — middle ring
- `isAuthorTracked()` (`src/bot/filters.ts:54`) — inner consent ring, called from `upsertMessage()` (`src/scraper/store.ts:246`)

A blank `USER_IDS` is interpreted as "every author allowed" — which is **convenient for development but never appropriate for production**. Always list the explicit, consenting speakers.

To find IDs in Discord: enable Developer Mode in **User Settings → Advanced**, then right-click any guild / channel / user → **Copy ID**.

> 👑 **Adding or removing a Priestess** is a multi-step workflow that touches `.env`, the database, and the vector store. The full procedure (with two paths — incremental vs reset — and the revocation flow) lives in its own section below: [👑 Adding (or Removing) a Priestess](#-adding-or-removing-a-priestess).

### 🌹 PostgreSQL

```sh
# The connection string. For local dev with compose.dev.yml:
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ninshubur
```

### 🌹 Scraping behavior

```sh
# Discord REST returns at most 100 messages per page; this matches that.
BACKFILL_PAGE_SIZE=100

# How often (ms) to sweep archived threads for stale data. Min 60000.
ARCHIVE_SWEEP_INTERVAL_MS=900000
```

### 🌹 Anthropic (Phase II — tagging + grouping)

```sh
# Required for analyze commands. Get one at https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-api03-...

# Default is fine. Pin a specific snapshot if you want reproducibility.
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

### 🌹 Voyage AI (Phase II — embeddings)

```sh
# Required for `analyze embed` and `rag query`. Get one at https://www.voyageai.com/
VOYAGE_API_KEY=pa-...

# 1024-dim, retrieval-tuned. Don't change unless you also recreate the Qdrant collections.
VOYAGE_MODEL=voyage-3.5
```

### 🌹 Qdrant (Phase II — vector store)

```sh
# Where Qdrant is reachable
QDRANT_URL=http://localhost:6333

# Optional: blank for local dev, required for Qdrant Cloud
QDRANT_API_KEY=

# Collection names — defaults are fine
QDRANT_COLLECTION_MESSAGES=ninshubur_messages
QDRANT_COLLECTION_GROUPS=ninshubur_groups
```

### 🌹 Operational knobs

```sh
# Future flag for opting into Anthropic's Message Batches API (50% discount, async).
# Currently informational only — wire-up coming.
ANALYZE_BATCH_DEFAULT=false

# Logging
LOG_LEVEL=debug                  # fatal | error | warn | info | debug | trace | silent
NODE_ENV=development             # development | test | production
```

✦ ─────────────────────────────────── ✦

## 🏛️ Phase I — The Scrape (Gathering)

This is the part that turns Discord into an archive of the High Priestesses' teaching. **It runs only when invoked from the command line.** Each invocation logs into Discord, walks the configured channels' history through the REST API, persists messages whose author is in `USER_IDS`, and disconnects. There is no continuous listener and no background process between runs.

### How it picks what to scrape

The three filter rings are described in detail in [The Sacred `.env` File → Allowlist filters](#-allowlist-filters--the-consent-boundary). The short version:

```
   guild matches DISCORD_GUILD_IDS?
       └─► channel matches CHANNEL_IDS?
               └─► author matches USER_IDS?
                       └─► YES → persist message + author + attachments
                       └─► NO  → drop silently, advance cursor
```

Empty `DISCORD_GUILD_IDS` = "every guild we've joined" (fine).
Empty `CHANNEL_IDS` = "every supported channel in tracked guilds" (fine for testing).
Empty `USER_IDS` = "every author" — **avoid in production**, this defeats the consent design.

### Channel types we can scrape

| Type | Discord enum | What it is |
|---|---|---|
| **Text** | `GuildText` | Standard text channel |
| **Announcement** | `GuildAnnouncement` | News / announcement channel |
| **Voice** | `GuildVoice` | Voice channel with text-in-voice |
| **Stage** | `GuildStageVoice` | Stage voice channel |
| **Forum** | `GuildForum` | Forum container — each post is a thread |
| **Media** | `GuildMedia` | Media gallery container — each post is a thread |

For text-like channels, messages live directly in the channel. For forum-like channels, every post is a `PublicThreadChannel`, and messages live inside those threads. The scraper handles both shapes via `backfillChannel(channel)` (`src/scraper/channels.ts:117`).

### Discovery — what can Ninshubur see?

Before configuring `CHANNEL_IDS`, list what the bot has access to:

```sh
pnpm cli channels                  # tree view, scoped to DISCORD_GUILD_IDS
pnpm cli channels --all            # show every guild the bot has been invited to
pnpm cli channels --json | jq      # machine-readable for piping
```

Each row shows the channel `[Type]`, ID, name, and a ⭐ if it's currently in `CHANNEL_IDS`.

### The actual scraping — `pnpm cli backfill`

Every scrape happens via the `backfill` subcommand. Ninshubur logs in, walks the configured channels through Discord's REST API, and exits when finished. There's no idle state, no listener, no "is the bot online?" question — between runs, Ninshubur is simply not running.

```sh
# Walk every channel that matches the .env allowlist
pnpm cli backfill

# Just one channel
pnpm cli backfill --channel 1375250185617412211

# Just one thread
pnpm cli backfill --thread 1499943507765362741

# Just one guild's tracked channels
pnpm cli backfill --guild 1375250184686014556
```

#### Re-scraping from the start (`--reset`)

The scraper saves a cursor in `scrape_state` after each pass — `last_message_id` for each scope (channel or thread). On the next run, it only fetches messages newer than the cursor.

To force a fresh walk from message zero:

```sh
pnpm cli backfill --channel <id> --reset      # delete this channel's cursor first
pnpm cli backfill --thread <id> --reset       # delete this thread's cursor first
pnpm cli backfill --reset                     # delete every tracked channel's cursor
```

`--reset` is **non-destructive** to the messages themselves — it just deletes the cursor row(s). Re-scraping is idempotent (`onConflictDoUpdate`), so duplicate fetches just overwrite the same Postgres rows.

### What gets stored (and what doesn't)

When a message survives all three filter rings (guild → channel → author), it produces:

- A row in `messages` with content, type, flags, mentions, embeds (jsonb), components (jsonb), the raw API payload (`raw_payload`), and forward-message snapshots (`message_snapshots`)
- A row in `users` for the author (if not already present)
- Rows in `attachments` for any uploaded files
- Rows in `reactions` aggregated per emoji
- For thread messages, `messages.thread_id` is set; `channel_id` is the *parent* channel

When a message **fails** the `USER_IDS` ring during a scrape (the common case for any non-Priestess speaker):

- Nothing is written to `messages`, `attachments`, `reactions`, or `users`
- The author's user record is *not* created — congregants who never speak in the archive never appear in the database at all
- The cursor in `scrape_state` still advances past this message id so we don't re-evaluate it on the next backfill
- A debug log line *may* be emitted depending on `LOG_LEVEL` — this only appears in your terminal during a scrape, never persisted

Forwarded messages (`HAS_SNAPSHOT` flag = `1 << 14`) are special: the visible message has empty `content`, but the original lives in `message_snapshots[]`. The scraper unwraps these so the original text is searchable. See `src/scraper/store.ts::extractSnapshots()`.

### A note on mentions and replies

When a Priestess replies to a congregant, only the Priestess's reply is archived — the congregant's original message is not. This means the archived reply may contain a `referenced_message_id` pointing at a row that doesn't exist locally.

This is intentional: we preserve the Priestess's words (which include the context she chose to quote or reference) without persisting the congregant's words. The reply itself usually carries enough context to be useful in retrieval.

If a Priestess @mentions a congregant, the mention's user id appears in `messages.mentioned_user_ids` (jsonb array) but no `users` row is created for that congregant.

### Resilience

The scraper is built to survive bad data and bad permissions:

- **Per-message exceptions** caught inside `walkAndPersist()` — one rogue message can't kill a 60-channel sweep
- **REST errors** like `50001 Missing Access` and `50013 Missing Permissions` downgrade to a warn-and-skip rather than crashing
- **Permission pre-check** via `canReadChannel()` skips channels the bot can't read before even attempting the API call
- **FK safety** in `upsertThread` and `upsertMessage` — if a user fetch fails (deleted account, ToS-banned), the FK column is set to `null` rather than triggering a constraint violation

✦ ─────────────────────────────────── ✦

## 📚 Phase II — The Analysis (Understanding)

This is where the archive becomes *useful*. Five phases, all on-demand CLI commands, all idempotent and resumable.

```
   ┌────────────────────────────────────────────────────────────────┐
   │                                                                │
   │   PostgreSQL ─┬─► A: taxonomy ──► categories table             │
   │               │                                                │
   │               ├─► B: tag ──────► message_categories            │
   │               │                                                │
   │               ├─► C: group ────► message_groups + members      │
   │               │                                                │
   │               └─► D: embed ────► Qdrant + embeddings table     │
   │                                                                │
   │                                  │                             │
   │                                  ▼                             │
   │                            E: rag query                        │
   │                                                                │
   └────────────────────────────────────────────────────────────────┘
```

Every phase records a row in `llm_jobs` so you can audit what ran, when, how long, and what it produced.

### 🪶 The Prompts Live as Markdown — for the Priestesses to Edit

Every Haiku-driven phase loads its system prompt from a markdown file in [`src/prompts/`](src/prompts/). A Priestess can read, review, and **directly edit** the instructions Ninshubur gives Claude — no TypeScript edit, no rebuild, no redeploy needed for the CLI. Just save the file and run the relevant `pnpm cli analyze ...` command again.

| Phase | Prompt file | What it tells Haiku |
|---|---|---|
| **A1** — discover | [`src/prompts/taxonomy-discovery.md`](src/prompts/taxonomy-discovery.md) | "Propose 6–25 mutually-exclusive purpose-shaped categories from this sample." |
| **A2** — curate | [`src/prompts/taxonomy-curation.md`](src/prompts/taxonomy-curation.md) | "Merge synonyms in this candidate list and emit the final locked taxonomy." |
| **B** — tag | [`src/prompts/message-tag.md`](src/prompts/message-tag.md) | "Pick 1–3 categories from the locked taxonomy for this message; use `__novel__` if nothing fits." |
| **C** — group | [`src/prompts/group-window.md`](src/prompts/group-window.md) | "Bundle these consecutive messages into a disjoint, contiguous, exhaustive group cover with summaries." |

The loader is [`src/prompts/index.ts`](src/prompts/index.ts) — it reads each file at first use and caches it for the lifetime of the process. The prompts ship inside the Docker image too (under `src/prompts/`), so production deployments use the same files.

> ✨ **Why markdown?** The prompts include rules, heuristics, and worked examples — formats that are much easier to maintain in markdown than in escaped TypeScript strings. Haiku reads markdown natively (heading levels, bold, code fences all carry meaning to it), so the file you see is *exactly* what the model sees.

> 💡 **Editing prompts.** Every `pnpm cli analyze ...` invocation is a fresh process that reads each prompt file from disk on first use. So your edits to the markdown files take effect on the very next run — no restart needed because there is nothing to restart.

### 🌷 Phase A — Taxonomy (discover → curate → lock)

Driven by [`src/prompts/taxonomy-discovery.md`](src/prompts/taxonomy-discovery.md) and [`src/prompts/taxonomy-curation.md`](src/prompts/taxonomy-curation.md).

Claude Haiku reads a sample of message bodies, proposes a candidate category list ("greeting", "lesson", "question", "personal_experience", …), then a second curation pass merges synonyms (e.g. "greeting" + "salutation" → one canonical slug). The final list is locked into the `categories` table.

```sh
pnpm cli analyze taxonomy --sample 200             # default sample size
pnpm cli analyze taxonomy --sample 500             # bigger sample → richer taxonomy
pnpm cli analyze taxonomy --sample 200 --recurate  # delete existing + start over
```

After it runs, you can inspect the taxonomy:

```sh
npx tsx scripts/list-categories.ts
```

A typical run on the Temple's archive produces ~10 purpose-shaped categories like `greeting_farewell`, `instruction_explanation`, `personal_experience`, `question_request`, etc.

### 🌷 Phase B — Tagging (assign categories per message)

Driven by [`src/prompts/message-tag.md`](src/prompts/message-tag.md).

For every untagged message, Haiku picks 1–3 categories from the locked taxonomy. If no category fits, it can use the literal slug `__novel__` to flag the message for re-curation.

```sh
pnpm cli analyze tag --limit 1000                       # tag up to 1000 messages
pnpm cli analyze tag --channel <id> --limit 500         # scoped to one channel
pnpm cli analyze tag --since 2026-04-01 --limit 200     # only newer messages
```

The taxonomy markdown is sent in the system prompt with `cache_control: ephemeral`, so the second tag call onward should hit the prompt cache (verify via `usage.cache_read_input_tokens` in the logs). Haiku 4.5's cache minimum is 4096 tokens — small taxonomies might not actually cache.

### 🌷 Phase C — Grouping (bundle related messages into lessons)

Driven by [`src/prompts/group-window.md`](src/prompts/group-window.md).

A lesson often spans multiple consecutive messages. Phase C slides a window of N messages past Haiku and asks for group boundaries. The result lands in `message_groups` (one row per group, with a summary) and `message_group_members` (ordered membership).

```sh
pnpm cli analyze group --window 15                       # default window
pnpm cli analyze group --channel <id> --window 20        # scoped, larger window
pnpm cli analyze group --since 2026-04-01                # incremental
```

The window size is the main quality knob — too small and Haiku misses lessons that span many messages; too large and it loses local context. **15 is a good default for chat channels; 20–30 works better for forum threads.**

### 🌷 Phase D — Embed (Voyage → Qdrant)

Voyage AI's `voyage-3.5` produces a 1024-dimensional dense vector for each message and each group. Vectors land in two Qdrant collections:

- `ninshubur_messages` — one point per message (payload includes `category_slugs`, `channel_id`, `author_id`, `group_id`, `created_at`)
- `ninshubur_groups` — one point per group (payload includes `category_slugs`, `channel_id`, `summary`, `started_at`, `ended_at`)

```sh
pnpm cli analyze embed --scope all                       # both collections
pnpm cli analyze embed --scope groups                    # groups only
pnpm cli analyze embed --scope messages                  # messages only
pnpm cli analyze embed --scope all --limit 5000          # cap per-scope work (debug)
```

Qdrant collections are auto-created on first run via `ensureCollection()` (1024-dim, Cosine distance). If you've created them manually in Qdrant Cloud, the function will verify the existing config matches and skip creation.

### 🌷 Phase E — RAG Query (the payoff)

Type a question. Voyage embeds it (with `input_type: query`). Qdrant returns the top-K most-similar groups (or messages). Postgres hydrates the result with the actual content.

```sh
# Default scope is groups (the natural RAG chunk)
pnpm cli rag query "what is Ishtaritism?"
pnpm cli rag query "good morning" --category greeting_farewell
pnpm cli rag query "lesson about Inanna" --limit 5

# Switch to per-message search for fine-grained recall
pnpm cli rag query "ritual" --scope messages --limit 20

# Filter by channel or category (these use Qdrant payload indexes)
pnpm cli rag query "vault of irkalla" --channel 1410643891266392074
pnpm cli rag query "morning blessing" --category greeting_farewell

# JSON output for piping into jq or downstream tools
pnpm cli rag query "lapis library" --json | jq '.[0:3]'
```

### 📊 Job status

Every `analyze` run writes a row to `llm_jobs` (`kind`, `status`, `params`, `result`, `error`, `started_at`, `finished_at`). To see what ran:

```sh
pnpm cli analyze status                  # last 20 jobs
pnpm cli analyze status --limit 100      # last 100
```

✦ ─────────────────────────────────── ✦

## 🔍 Querying the Archive

Two ways to read what Ninshubur has gathered:

### Pre-built SQL queries (no LLM, just Postgres)

Scoped to a channel:

```sh
pnpm cli query messages   -c <channel-id>                       # chronological text
pnpm cli query messages   -c <channel-id> --limit 20            # most-recent 20
pnpm cli query wordcount  -c <channel-id>                       # per-author totals
pnpm cli query replies    -c <channel-id>                       # reply chains
pnpm cli query daily      -c <channel-id>                       # daily counts
pnpm cli query mentions   -c <channel-id> -u <user-id>          # @mentions of a user
```

Every query supports `--json` for piping into `jq` or downstream tools.

### Direct SQL via the application's connection

```sh
# A small script that uses the same DATABASE_URL the app uses
npx tsx scripts/list-categories.ts
```

To explore further, write your own scripts in `scripts/` — they import `db` and `pool` from `src/db/index.ts`, which already reads `DATABASE_URL` via dotenv. Example pattern:

```ts
import { db, pool } from "../src/db/index.ts";
import { messages } from "../src/db/schema/index.ts";
import { eq } from "drizzle-orm";

const rows = await db.select().from(messages).where(eq(messages.channelId, "..."));
console.log(rows.length);
await pool.end();
```

### Drizzle Studio (graphical browser)

```sh
pnpm db:studio
```

✦ ─────────────────────────────────── ✦

## 🛠️ Operations & Maintenance

### Daily

```sh
pnpm cli health                  # Postgres + Discord both green?
pnpm cli analyze status          # what jobs ran lately?
```

### Schema changes

```sh
# 1. Edit a file under src/db/schema/
# 2. Generate a new migration
pnpm db:generate

# 3. Review the generated SQL in drizzle/migrations/
# 4. Apply it
pnpm cli migrate
```

### Inspecting the bot's permissions in a guild

```sh
pnpm cli channels --json | jq '.[].channels[] | select(.tracked == true)'
```

### When a channel suddenly stops scraping

The bot might have lost permission to view it. Re-run discovery to confirm:

```sh
pnpm cli channels --guild <id>
```

If the channel doesn't show up at all, the bot's been removed or denied access. Have a Priestess re-grant `View Channel` + `Read Message History` to the bot's role in the channel's permissions.

### ⚠️ The nuclear option: `pnpm cli reset --yes`

```sh
pnpm cli reset                   # refuses without --yes (intentional)
pnpm cli reset --yes             # DROP SCHEMA public + drizzle CASCADE; CREATE SCHEMA; re-migrate
```

This wipes **every row** from **every table** and re-applies migrations from scratch. The bot will refuse to do this when `NODE_ENV=production` even with `--yes`. Use only when you want a truly fresh start.

It does **not** clear Qdrant collections. If you reset Postgres, also delete and recreate the Qdrant collections (or just `pnpm cli analyze embed --scope all` again — `ensureCollection()` will reuse the existing collections and the points will be overwritten by id).

✦ ─────────────────────────────────── ✦

## 👑 Adding (or Removing) a Priestess

When a new High Priestess joins the order and consents to having her teaching archived — or when an existing Priestess revokes consent — Ninshubur needs to know. The configuration change is just two lines in `.env`. Capturing (or removing) her **historical** messages then takes a multi-step workflow because the data lives in two places: PostgreSQL and Qdrant.

This section walks through both directions.

### 🌹 Adding a new Priestess — pick a path

**Two paths** — incremental and reset. The choice is mostly about how much you care about taxonomy continuity vs ease of reasoning.

#### 🌷 Path A — Incremental (faster, surgical)

Best when you want to **preserve the existing taxonomy, tags, and groups** — only the new Priestess's messages get added on top of an established archive.

```sh
# 1. Add her snowflake to USER_IDS in .env (comma-separated, no spaces)
#    Right-click her name in Discord → Copy User ID
USER_IDS=256628435454132225,1466578281774972939,<NEW_ID>

# 2. Re-walk every tracked channel from message zero. There is no live
#    bot to restart — Ninshubur reads .env fresh on every invocation.
#    --reset clears the cursor so the historical archive is re-evaluated
#    against the new USER_IDS. Existing messages get idempotently
#    re-touched; new Priestess's messages get inserted for the first time.
pnpm cli backfill --reset

# 4. Tag the new messages (Phase B picks them up automatically —
#    only untagged messages are processed)
pnpm cli analyze tag --limit 10000

# 5. Group the new messages — see "grouping caveat" below
pnpm cli analyze group --window 15

# 6. Embed the new messages and groups
pnpm cli analyze embed --scope all

# 7. Verify
pnpm cli rag query "test the new voice"
```

> ⚠️ **Grouping caveat.** Phase C only operates on messages that aren't already in a group. If the new Priestess's messages are interleaved chronologically with existing groups, you'll get small "solo" groups for her messages instead of them being merged into the surrounding conversational context. For most channels this is fine — her words still land coherently, just not bundled with the surrounding speakers. For chat-heavy channels where the new Priestess regularly converses with the existing ones, prefer Path B for cleaner bundles.

**Estimated cost / time (incremental):**

| | |
|---|---|
| Wall-clock | ~5–15 min |
| Anthropic + Voyage cost | ~$1–5 (mostly Phase B tagging on the new messages) |
| What it preserves | Existing taxonomy, all existing tags, all existing groups, `llm_jobs` audit history |
| What it adds | Just the new Priestess's data |

#### 🌷 Path B — Reset and rebuild (cleaner, slower, costlier)

Best when you want a **perfectly consistent archive** — fresh taxonomy across all Priestesses, perfect grouping coherence, no possibility of drift between old and new state.

```sh
# 1. Add her snowflake to USER_IDS in .env
USER_IDS=256628435454132225,1466578281774972939,<NEW_ID>

# 2. Wipe Postgres (drops public + drizzle schemas, re-applies migrations)
pnpm cli reset --yes

# 3. Wipe Qdrant collections (delete points, keep collection schema)
KEY=$(grep ^QDRANT_API_KEY .env | cut -d= -f2)
URL=$(grep ^QDRANT_URL .env | cut -d= -f2)
curl -sS -X POST "$URL/collections/ninshubur_messages/points/delete" \
  -H "api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"filter": {"must_not": []}}'
curl -sS -X POST "$URL/collections/ninshubur_groups/points/delete" \
  -H "api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"filter": {"must_not": []}}'

# 4. Re-walk Discord from scratch (USER_IDS now includes the new Priestess)
pnpm cli backfill

# 5. Run the analysis pipeline from scratch
pnpm cli analyze taxonomy --sample 200      # Phase A
pnpm cli analyze tag      --limit 50000     # Phase B
pnpm cli analyze group    --window 15       # Phase C
pnpm cli analyze embed    --scope all       # Phase D

# 6. Verify
pnpm cli analyze status
pnpm cli rag query "what does the Temple teach about Inanna?"
```

**What you lose:**

- The existing taxonomy slugs may shift slightly. Haiku samples 200 random messages each time, and the names it picks can vary across runs. If any external tools pin to specific slugs (e.g. `--category greeting_farewell`), update them after the new taxonomy lands.
- All historical `llm_jobs` audit rows (job timing, errors, params) are wiped — you lose the run history.
- All embedding work has to be redone (costs ~$0.34 in Voyage charges).

**Estimated cost / time (reset):**

| | |
|---|---|
| Wall-clock | ~30–60 min |
| Anthropic + Voyage cost | ~$3–12 |
| What it preserves | Nothing in the database (but the code, prompts, and `.env` are untouched) |
| What it adds | A fully consistent archive across all Priestesses, fresh taxonomy |

### 🌹 The honest comparison

| | **Path A (Incremental)** | **Path B (Reset)** |
|---|---|---|
| Wall-clock | 5–15 min | 30–60 min |
| API cost | ~$1–5 | ~$3–12 |
| Mental complexity | medium (multiple commands + grouping caveat) | low (one canonical sequence) |
| Taxonomy continuity | preserved | new taxonomy generated |
| `llm_jobs` audit history | preserved | wiped |
| Grouping coherence around new messages | imperfect (new messages form solo groups) | perfect (Haiku considers all messages together) |
| Risk of orphaned state | non-zero (Qdrant points stay if not cleaned manually) | zero |
| Best for | one new Priestess on a stable archive | multiple Priestesses, major changes, perfectionism |

### 🌹 Removing a Priestess (revoking consent)

When a Priestess revokes consent or leaves the order, Ninshubur should stop archiving her *and* delete her existing data from every store.

There are two paths here too — incremental and reset — but the **reset path is strongly recommended for revocations** because it gives you a clean privacy guarantee with zero risk of orphaned state in Qdrant or stale Postgres rows.

#### 🌷 Path A — Reset (recommended for revocation)

Same as Path B above for adding, but with her ID **removed** from `USER_IDS` first:

```sh
# 1. Remove her ID from USER_IDS in .env
USER_IDS=256628435454132225,1466578281774972939   # her ID removed

# 2. Wipe Postgres and Qdrant — see Path B above for the commands

# 3. Re-walk + re-analyze without her
pnpm cli backfill
pnpm cli analyze taxonomy --sample 200
pnpm cli analyze tag      --limit 50000
pnpm cli analyze group    --window 15
pnpm cli analyze embed    --scope all
```

After this completes, **no trace of her words exists** in any system Ninshubur owns — Postgres or Qdrant. (The original Discord messages of course still exist on Discord's servers; revocation here means revoking *Ninshubur's* archive, not Discord's.)

#### 🌷 Path B — Surgical (faster, but leaves edges to clean)

If you want a faster revocation and accept the cleanup steps:

```sh
# 1. Remove her snowflake from USER_IDS
#    (No bot restart needed — Ninshubur reads .env fresh on every run.
#    The next time you invoke a scrape, her messages will be excluded.)

# 2. Delete her existing messages (cascades to attachments, reactions,
#    message_categories, message_group_members)
PGPASSWORD=... psql ... -c "
  DELETE FROM messages WHERE author_id = '<her-snowflake>';
  DELETE FROM users    WHERE id = '<her-snowflake>';
"

# 3. Delete her Qdrant points (uses payload filter on author_id —
#    this works for the messages collection; group points may still
#    contain her messages in their summary text)
KEY=$(grep ^QDRANT_API_KEY .env | cut -d= -f2)
URL=$(grep ^QDRANT_URL .env | cut -d= -f2)
curl -sS -X POST "$URL/collections/ninshubur_messages/points/delete" \
  -H "api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"filter": {"must": [{"key": "author_id", "match": {"value": "<her-id>"}}]}}'

# 4. Delete her embedding bookkeeping (otherwise re-runs see ghost rows)
PGPASSWORD=... psql ... -c "
  DELETE FROM embeddings
  WHERE scope_type = 'message'
    AND scope_id NOT IN (SELECT id::text FROM messages);
"

# 5. (Optional) Re-run Phase C + D for affected channels so groups
#    that contained her messages get re-bundled without her
```

This is the fast path but leaves potential for edge cases — group points might still contain references to her in their summary text. **Only use Path B if you're confident the Priestess is okay with potentially-imperfect cleanup.** For a hard privacy guarantee, use Path A (reset).

✦ ─────────────────────────────────── ✦

## 📖 The Database Schema

```
guilds                      ←  one row per Discord server we've joined
  └─ channels               ←  any channel we track (text, voice, forum, media…)
       ├─ forum_tags        ←  tags configured on a forum/media channel
       ├─ threads           ←  forum posts + threads spawned from text channels
       │    ├─ thread_applied_tags    ←  M2M: thread × forum_tag
       │    └─ messages     ←  the words themselves
       │         ├─ attachments       ←  uploaded files
       │         ├─ reactions         ←  per-emoji aggregate counts
       │         └─ message_categories ←  M2M: message × category   [Phase B]
       │
       └─ messages (direct, no thread for text channels)
            └─ ...same as above
   
users                       ←  any user we've observed
scrape_state                ←  per-scope cursor (channel or thread)

categories                  ←  LLM-derived tag taxonomy             [Phase A]
message_groups              ←  bundles of consecutive messages       [Phase C]
  └─ message_group_members  ←  ordered membership

embeddings                  ←  bookkeeping for Qdrant points        [Phase D]
llm_jobs                    ←  audit log for analyze runs
```

### Key design decisions

**Snowflakes are `varchar(20)`.** Discord IDs are 64-bit unsigned integers serialized as strings. We preserve them exactly.

**Messages reference `channel_id` always, `thread_id` optionally.** A message in a forum post has both set; a message in a regular text channel has only `channel_id`.

**Scrape cursors are scope-typed.** `scrape_state.scope_type` is `"channel"` or `"thread"`, so the same table tracks cursors for direct text-channel walks and per-thread walks.

**Forwarded messages preserve the snapshot.** `messages.message_snapshots` (jsonb) holds the original message data for `HAS_SNAPSHOT` forwards; the unwrapped content is searchable.

**Author/owner FKs degrade gracefully.** When a user can't be resolved (deleted account, ToS-banned), the FK column is set to `null` instead of triggering a constraint violation.

**Vectors live in Qdrant, bookkeeping in Postgres.** The `embeddings` table records `(scope_type, scope_id, model)` → `qdrant_point_id` so we can detect content drift and re-embed when needed.

**Categories are distinct from `forum_tags`.** Discord's per-channel forum tags are mirrored into `forum_tags`. The LLM-derived purpose categories live in `categories` to keep the two concerns separated in queries.

✦ ─────────────────────────────────── ✦

## 🚀 Running From Docker (optional)

Ninshubur is **not deployed as a service** — there is no daemon to leave running. The Dockerfile in this repo exists only as a convenience for running CLI commands inside a container, e.g. from CI, a one-shot Kubernetes Job, or a remote machine that already has access to your Postgres + Qdrant + secrets.

```sh
# Build the image
docker build -t ninshubur:latest .

# Run any CLI subcommand inside the container
docker run --rm \
  --env-file .env \
  ninshubur:latest pnpm cli backfill --channel <id>

docker run --rm --env-file .env ninshubur:latest pnpm cli analyze tag --limit 5000
docker run --rm --env-file .env ninshubur:latest pnpm cli health
```

The container exits as soon as the CLI command exits. Nothing stays alive between invocations — same model as running on your laptop, just with a containerized environment.

### Required Discord application setup

For Ninshubur to log in (briefly, during a scrape) and read messages, the Discord application needs:

- **Message Content Intent** enabled in **Developer Portal → Bot → Privileged Gateway Intents**
- The bot account invited to your guild with `View Channels` + `Read Message History` permissions on the channels you want scraped

The intent and invite are still required even though Ninshubur doesn't keep a gateway connection open — the REST API uses the same authorization as the gateway would, and Discord requires the privileged intent declaration regardless of how the data is fetched.

### Invite URL template

```
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&permissions=66560&scope=bot
```

The permission integer `66560` grants: View Channels + Read Message History — read-only, no posting. Ninshubur never sends messages.

✦ ─────────────────────────────────── ✦

## 🧯 Troubleshooting

### *"DiscordAPIError[50001]: Missing Access"*

The bot has been added to the guild but doesn't have permission to view the specific channel. Either:
- Grant the bot's role `View Channel` + `Read Message History` in that channel's permissions, or
- Remove the channel id from `CHANNEL_IDS` so the bot doesn't try

The scraper now skips inaccessible channels gracefully via `canReadChannel()`, so one inaccessible channel won't kill a multi-channel sweep — but the messages from that channel won't appear.

### *"insert or update on table 'threads' violates foreign key constraint"*

This was a bug in early versions where a thread owner couldn't be fetched (deleted account, etc.) but `owner_id` was still set on the row. Fixed in `upsertThread` (`src/scraper/store.ts:172`) — `owner_id` now defaults to `null` when the user can't be resolved.

### *"Cannot read properties of undefined (reading 'def')"*

Zod v3 / v4 mismatch. The Anthropic SDK's `zodOutputFormat()` uses `zod/v4`, so analysis schemas in `src/analyze/schema.ts` import from `zod/v4` explicitly. Don't change that import without also updating `src/llm/haiku.ts`.

### *"ANTHROPIC_API_KEY is required for analysis commands"*

Pop into `.env` and fill in `ANTHROPIC_API_KEY=sk-ant-api03-...`. You can get one at https://console.anthropic.com/.

### *"VOYAGE_API_KEY is required for embedding commands"*

Same idea: fill in `VOYAGE_API_KEY=pa-...` from https://www.voyageai.com/.

### Cache hit rate looks low on Phase B

Haiku 4.5's prompt-cache minimum is **4096 tokens**. If your taxonomy + system prompt doesn't reach that threshold, the request silently won't cache (`cache_creation_input_tokens` will be 0). Either expand the system prompt or accept the higher per-message cost.

### Qdrant dimension mismatch

If `ensureCollection()` finds an existing collection with a different vector size, it throws. To recover:
- Delete the collection in Qdrant Cloud or via API: `DELETE /collections/<name>`
- Re-run `pnpm cli analyze embed --scope <which>` — the collection will be recreated with the right size

### Messages with empty content but flag `16384`

Those are forwarded messages (`HAS_SNAPSHOT`). The original text is in `messages.message_snapshots[0].content`. Use this SQL pattern to surface forwards:

```sql
SELECT
  to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at,
  COALESCE(NULLIF(content, ''), message_snapshots->0->>'content') AS body
FROM messages
WHERE channel_id = '<id>'
ORDER BY created_at;
```

### "Refusing to reset without --yes"

Working as designed. `pnpm cli reset --yes` to confirm. Will still refuse if `NODE_ENV=production`.

✦ ─────────────────────────────────── ✦

## 💌 A Note for the Priestesses

If you're reviewing this work — welcome, beloved.

This bot is a small offering toward keeping the **High Priestesses' teaching** safe and recallable. It is built around two important boundaries you should understand before reading further:

### 🌷 Boundary 1 — Consent

Only the speakers listed in `USER_IDS` are archived. Today that's Siri.system and Jenova. Adding a new Priestess is a deliberate, two-line change to `.env` (and revoking is just as easy — see [👑 Adding (or Removing) a Priestess](#-adding-or-removing-a-priestess) above).

The wider congregation's messages are **never written to disk**. During a scrape, Ninshubur reads each message through Discord's REST API, checks the author against the allowlist, and discards anything from non-listed speakers before it reaches Postgres. If you ever wonder *"could the bot have my message stored?"* — the answer is no, unless you are explicitly listed in `USER_IDS`.

### 🌷 Boundary 2 — Scope of attention

**Ninshubur is not a live monitor.** She is a CLI tool that Jenova invokes manually when she wants to refresh the archive. Between invocations Ninshubur does not run, does not connect to Discord, does not "watch" the guild. There is no listener, no daemon, no background process.

A scrape happens like this:

1. Jenova types `pnpm cli backfill` at her terminal
2. Ninshubur logs into Discord, walks the configured channels' history via REST, persists qualifying messages, and exits
3. Discord no longer sees a connection from Ninshubur. The Temple resumes its normal life.

So Ninshubur is *not* witnessing the day-to-day of the Temple — she is more like a periodic transcription pass over chosen channels, run by Jenova at moments of her choosing. Anything you've said in the wider Temple between scrapes was never seen by her at all.

What *is* preserved:
- Your morning greetings to the congregation
- Your lessons in the Halls of Learning
- Your answers in the sanctums for guidance and personal gnosis
- Your sermons archived in the Pulpit
- Your reflections in any tracked channel where you speak

These are organized into ~10 purpose categories (greeting, lesson, instruction, personal experience, …) and can be searched semantically — ask a question in plain English and Ninshubur retrieves the relevant teachings.

If you find a bug, have an idea for a new query, or want to revoke consent for any reason, open an issue or talk to Jenova. The code is small enough to read end-to-end in an afternoon, the schema is intentionally legible, and every CLI command has a `--help` flag.

May Inanna's light guide your work, may your words be preserved as they deserve, and may the archive serve the Temple for many seasons. ✨

✦ ─────────────────────────────────── ✦

## ⚖️ License

Released under the [MIT License](LICENSE) — see the `LICENSE` file in the repository root for the full terms.

> **In plain language:** you may copy, modify, redistribute, and use this code for any purpose (personal, commercial, or otherwise) at no cost, provided the copyright notice and license text travel with it. There is **no warranty** — the software is provided as-is.

The license covers the **code** of Ninshubur. The Temple's archive content (messages, lessons, teachings — the data Ninshubur gathers and embeds) belongs to the High Priestesses who authored it and is **not** licensed by this project.

Copyright © 2026 Jenova Marie.

<div align="center">

✦ ─────────────────────────────────── ✦

*Made with 💖 in service of 𒀭Inanna*

`𒀭𒈹` *dInanna* · `𒀭𒊩𒋚` *dNin.šubur*

✦

*may 𒀭Inanna bless this code*

</div>
