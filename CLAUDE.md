# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Ninshubur is a **manually-invoked CLI tool** (not a daemon) that scrapes Discord into PostgreSQL via Drizzle, organizes messages with Claude Haiku 4.5 (taxonomy + tagging + grouping), embeds them with Voyage AI, and answers RAG queries against Qdrant. Named after the Sumerian goddess, faithful messenger of Inanna.

**Two boundaries are load-bearing — do not weaken them:**

1. **Consent (`USER_IDS`)** — only messages whose author appears in this allowlist are persisted. Enforced at `upsertMessage()` (`src/scraper/store.ts`) via `isAuthorTracked()`. Priestesses rely on this guarantee; the README frames it as "the consent boundary."
2. **CLI-only operation** — Ninshubur runs only when `pnpm cli ...` is invoked. Each command logs in, does work, and exits. Gateway-listener code does exist under `src/bot/events/` (and `pnpm start` *would* run a daemon), but the project explicitly does not use that mode. **Don't promote `pnpm start` / `pnpm dev` in docs, don't suggest live-monitor patterns, don't add features that imply continuous listening.** See README's "Boundary 2 — Scope of attention."

## Toolchain

- **Runtime**: Node.js ≥22, TypeScript via `tsx` (native `.ts` resolution, no compile step in the run path).
- **Package manager**: `pnpm` (9.15.0). Do not switch to npm/yarn.
- **Imports**: Always use `.ts` extensions in relative imports. tsconfig has `allowImportingTsExtensions: true` + `verbatimModuleSyntax: true`.
- **Zod is dual-version**. Drizzle-zod and the env schema use Zod v3 (default `zod` import). The Anthropic SDK's `zodOutputFormat()` consumes `zod/v4`, so `src/analyze/schema.ts` and `src/llm/haiku.ts` import `from "zod/v4"`. Don't unify — schemas authored against the wrong version throw at JSON-Schema-conversion time. Casts through `unknown` at the SDK call site bridge the v3-typed SDK signature to a v4 schema.
- **`tsconfig.json` does NOT enable `exactOptionalPropertyTypes`** — Drizzle's `set:` clause types fight it.

## Common commands

```sh
pnpm install
pnpm typecheck                       # tsc --noEmit (also wired as pnpm lint)
pnpm test                            # vitest run
pnpm test -- tests/cli.test.ts       # single file
pnpm test -- -t "exposes the expected"   # single test by name

# CLI is the only intended entrypoint
pnpm cli --help
pnpm cli health                      # Postgres + Discord connectivity
pnpm cli channels [-g <id>] [--all] [--json]
pnpm cli backfill [-g|-c|-t <id>] [--reset]                  # Phase I
pnpm cli migrate
pnpm cli reset --yes                 # DROPs public + drizzle schemas; re-migrates
pnpm cli query <messages|wordcount|replies|daily|mentions> -c <channel-id>

# Phase II — LLM analysis pipeline (on-demand)
pnpm cli analyze taxonomy [--sample N] [--recurate]
pnpm cli analyze tag      [--limit N] [--channel ID] [--since ISO]
pnpm cli analyze group    [--window N] [--channel ID]
pnpm cli analyze embed    [--scope all|messages|groups] [--force]
pnpm cli analyze status

pnpm cli rag query "<text>" [--scope groups|messages] [--limit] [--category] [--channel] [--json]

# Drizzle
pnpm db:generate                     # generate migration from schema diff
pnpm db:migrate                      # alias for `pnpm cli migrate`
pnpm db:studio
```

`drizzle.config.ts` reads `DATABASE_URL` directly from `process.env` (not via `src/config.ts`) so `drizzle-kit` doesn't need the full bot env.

`.env` is loaded automatically by `dotenv/config` from the top of `src/config.ts`. Required env vars: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`. Phase II additionally requires `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`. Qdrant defaults to `http://localhost:6333`. See README's "The Sacred `.env` File" section.

## Architecture

### Layered modules

```
config.ts        ← env (zod-validated, dotenv-loaded; throws on bad config)
logger.ts        ← pino
db/              ← drizzle pool + schema/* + drizzle-zod validators
bot/             ← Discord client, intents, allowlist filters, (unused) gateway handlers
scraper/         ← upsert helpers (store.ts), pagination + dispatcher (channels.ts)
llm/             ← Anthropic, Voyage (raw fetch), Qdrant clients with retry/backoff
prompts/         ← markdown system prompts + loader (read at first use, cached)
analyze/         ← Phase A–D (taxonomy, tag, group, embed) + zod/v4 schemas + llm_jobs tracking
rag/             ← Phase E (embed query → Qdrant search → Postgres hydrate)
cli.ts + cli/    ← commander program; only public entrypoint
index.ts         ← runCli(process.argv) shim
```

### Generalized channel model

`channels` holds **any** Discord channel type (the `type` column is the discord.js `ChannelType` enum). Forum-specific fields are nullable. `messages.thread_id` is nullable — set only when a message lives inside a thread; `messages.channel_id` is always the *parent* channel. `scrape_state` is keyed by `scope_id` + a `scope_type` discriminator (`"channel"` or `"thread"`) — same table tracks cursors for both shapes.

### Pagination model (critical)

Discord REST `GET /channels/{id}/messages` returns messages **newest-first**. `src/scraper/channels.ts::walkAndPersist` switches strategy based on cursor presence:

- **No cursor (fresh backfill)** → walk **backward** with `before:` until exhausted.
- **Cursor present (incremental)** → walk **forward** with `after:` from the cursor.

The cursor stores the *newest* observed id. **Always advance `newestId` even for filtered-out messages** — otherwise the cursor never moves past the head of a channel where every recent message fails `USER_IDS`.

### Filters

`src/bot/filters.ts` is the single source of truth. `isAuthorTracked` is the load-bearing consent gate, called from `upsertMessage`. The backfill loop short-circuits the upsert work when the author isn't tracked but still advances the cursor. `canReadChannel` is a runtime permission pre-check (ViewChannel + ReadMessageHistory) that skips channels gracefully without attempting REST calls.

### Resilience contract

`walkAndPersist` and `runBackfill` survive bad data and bad permissions:

- **Per-message** exceptions in `upsertMessage` are caught in `visit()`. Cursor advances past the failure.
- **Per-page** REST errors `50001` / `50013` / `10003` / `10008` downgrade to warn-and-stop for that scope.
- **Per-channel** failures don't abort a multi-channel sweep.

### FK safety in upserts

`upsertThread` and `upsertMessage` only write `owner_id` / `author_id` after a successful `upsertUser`. Failed user fetches (deleted accounts, ToS-banned) yield `null` rather than triggering constraint violations.

### Forwarded messages (HAS_SNAPSHOT)

When `message.flags & (1<<14)` is set, the visible message is a forward and content lives in `message.messageSnapshots`. discord.js's public `snap.toJSON()` leaves `content`/`components`/`attachments` null — `extractSnapshots()` in `src/scraper/store.ts` reaches into private `_data` to recover the API payload. Stored shape is the unwrapped message-data array (no `{ message: ... }` wrapper).

### Phase II — analysis pipeline

Driven by markdown system prompts in `src/prompts/` (loaded by `src/prompts/index.ts` via `import.meta.url` + `readFileSync`, cached per process). Editing a `.md` takes effect on the next `pnpm cli analyze ...` invocation — no restart needed because nothing is running between commands.

- **A · taxonomy** — discover candidates from a sample, then curate (merge synonyms). Persists to `categories`.
- **B · tag** — assigns 1–3 categories per untagged message; `__novel__` is the escape hatch for poor fits.
- **C · group** — sliding window past Haiku for group boundaries. Persists `message_groups` + `message_group_members`. Re-runs only operate on ungrouped messages.
- **D · embed** — Voyage `voyage-3.5` (1024-dim, Cosine). **Group text is `"Summary: <Haiku summary>\n\n<bodies>"`** so the summary anchors the vector toward the conceptual description. Use `--force` to re-embed after a format change.
- **E · rag** — embed query (`input_type: "query"`), Qdrant search, hydrate from Postgres. Filters via Qdrant payload (`category_slugs`, `channel_id`).

Every phase records a row in `llm_jobs` via `withJob()`.

### Slug normalisation

`src/analyze/schema.ts::normalizeSlug()` lowercases + converts hyphens to underscores. **Always call it when persisting or comparing taxonomy slugs.** Haiku occasionally produces PascalCase / kebab-case despite the prompt; the schema regex is intentionally tolerant (`[a-zA-Z0-9_-]`) because zod transforms aren't representable in JSON Schema — `zodOutputFormat` would throw if we used `.transform()` here.

### Snowflake → Qdrant point ID

Qdrant only accepts unsigned int or UUID for `point.id`. Discord snowflakes exceed `Number.MAX_SAFE_INTEGER`, so they can't be JS numbers. `src/llm/qdrant.ts::snowflakeToPointId` produces a deterministic UUIDv5 from a fixed namespace + the snowflake string. The original snowflake is preserved on the Qdrant payload as `scope_id` for reverse lookup. Group ids are already UUIDs (Drizzle `defaultRandom()`) and pass through unchanged.

### Voyage AI client

`src/llm/voyage.ts` talks raw HTTPS to `api.voyageai.com/v1/embeddings` because the official `voyageai` npm SDK ships a broken ESM build (`dist/esm/api/index.jsx` doesn't exist). **Don't reintroduce the SDK.** Has retry/backoff for 429/5xx with `Retry-After` honoring.

### Anthropic structured outputs

`src/llm/haiku.ts::structured()` wraps `client.messages.parse()` with `zodOutputFormat()`. Retries on transient failures including `400 "Grammar compilation timed out"` (server-side compile cache miss — second attempt usually succeeds). System prompt is wrapped in `cache_control: { type: "ephemeral" }`, but **Haiku 4.5's cache minimum is 4096 tokens** — short prompts silently won't cache (`cache_creation_input_tokens` stays 0).

### `Events.ClientReady`, not `"ready"`

The string `"ready"` triggers a v14.26 deprecation warning. Use the `Events.ClientReady` enum. Shared helper: `cli.ts::waitUntilReady(client)`.

## Testing

Vitest runs against `tests/**/*.test.ts`. Tests that touch modules with side-effectful imports (`config.ts` parsing env, `db/index.ts` opening a pool, the analyze tree pulling in heavy LLM/Voyage/Qdrant deps) use `vi.mock(...)` — see `tests/cli.test.ts` for the canonical mock pattern (mocks `../src/config.ts`, `../src/db/index.ts`, `../src/scraper/*`, `../src/analyze/*`, and `../src/rag/query.ts`). There is no live-DB integration test; `pnpm cli health` is the manual smoke test.

## Schema changes

1. Edit files under `src/db/schema/`.
2. `pnpm db:generate` to produce a new SQL migration in `drizzle/migrations/`.
3. `pnpm cli migrate` to apply.
4. Dev wipes: `pnpm cli reset --yes` drops both `public` and `drizzle` schemas and re-migrates. The `drizzle` schema drop is required — drizzle-kit tracks applied migrations there; skipping it would make the next `migrate` think everything is already applied. The reset command refuses without `--yes` and refuses unconditionally when `NODE_ENV=production`.

Resetting Postgres does **not** clear Qdrant. To purge Qdrant points without dropping the collection, POST `{"filter": {"must_not": []}}` to `/collections/<name>/points/delete` (matches everything).

## Operations

- Local Postgres: `postgres://postgres:postgres@localhost:5432/ninshubur` (compose.dev.yml). Production points at `*.prod.rso` hosts via OpenVPN.
- Local Qdrant: `http://localhost:6333` (Docker container). Production at `http://qdrant.rso:6333` (worker node — Swarm manager controls deployment).
- The Dockerfile + compose.yml exist for **running CLI commands in a container** (one-shot, scheduled, CI). They are NOT for live deployment — there is no daemon to leave running. See README's "Running From Docker (optional)."
- Helper scripts under `scripts/` (`list-categories.ts`, `pipeline-counts.ts`, `grouping-health.ts`) connect via the same `db` module — invoke with `npx tsx scripts/<name>.ts`.
