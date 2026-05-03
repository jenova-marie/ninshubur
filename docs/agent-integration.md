<div align="center">

# 𒀭 Ninshubur Agent Integration 𒀭

### *Wiring the Temple's Archive into a conversational agent*

✦ ─────────────────────────────────── ✦

</div>

> *"𒀭𒊩𒋚 carries the goddess's words faithfully — but a mortal still has to ask the right question."*

This document explains how to plug Ninshubur's RAG retrieval into an agent loop so that Claude (or any LLM) can answer questions grounded in the High Priestesses' archived teachings. It covers four integration shapes, from one-line in-process imports to MCP servers, with worked code for each and guidance on when to choose which.

✦ ─────────────────────────────────── ✦

## 📜 Table of Contents

1. [What you have today](#-what-you-have-today)
2. [The agent loop, conceptually](#-the-agent-loop-conceptually)
3. [Integration patterns — pick one](#-integration-patterns--pick-one)
4. [Pattern A — In-process import](#-pattern-a--in-process-import-simplest)
5. [Pattern B — CLI subprocess](#-pattern-b--cli-subprocess-language-agnostic)
6. [Pattern C — MCP server (recommended for Claude)](#-pattern-c--mcp-server-recommended-for-claude)
7. [Pattern D — HTTP endpoint](#-pattern-d--http-endpoint-for-distributed-systems)
8. [Building "The Temple Archivist" agent](#-building-the-temple-archivist-agent)
9. [Prompt engineering for RAG](#-prompt-engineering-for-rag)
10. [Citations & traceability](#-citations--traceability)
11. [Production considerations](#-production-considerations)

✦ ─────────────────────────────────── ✦

## 🪷 What you have today

The retrieval surface lives in `src/rag/query.ts` and exposes one async function:

```typescript
export async function runRagQuery(opts: RagQueryOptions): Promise<RagResult[]>;

interface RagQueryOptions {
  query: string;
  scope?: "messages" | "groups";   // default: "groups"
  limit?: number;                  // default: 10
  category?: string;               // filter by category slug
  channelId?: string;              // filter by channel id
}

interface RagResult {
  scopeType: "message" | "group";
  scopeId: string;
  score: number;                   // cosine similarity, 0..1
  payload: Record<string, unknown>;  // Qdrant payload
  hydrated: Record<string, unknown> | null;  // joined from Postgres
}
```

**The retrieval pipeline behind it:**

```
   query string
     │
     │  Voyage AI: embed with input_type="query" → 1024-dim vector
     ▼
   [vector]
     │
     │  Qdrant: cosine search against ninshubur_groups (or ninshubur_messages)
     ▼
   top-K hits with payload
     │
     │  Postgres: hydrate scope_id from message_groups or messages tables
     ▼
   RagResult[] — ready for the LLM
```

**What's in `payload` for groups:**
- `scope_type: "group"`, `scope_id: <uuid>`
- `channel_id`, `thread_id`, `summary`, `started_at`, `ended_at`, `message_count`
- `category_slugs[]` — for filtered retrieval

**What's in `hydrated` for groups:**
- Same as payload but joined fresh from Postgres (lets you trust DB-current state over Qdrant-cached payload)

✦ ─────────────────────────────────── ✦

## 🌙 The agent loop, conceptually

A conversational agent that uses the Temple's archive looks like this:

```
   user: "What does the Temple teach about ritual purity?"
            │
            ▼
   ┌────────────────────────────────────┐
   │  Claude (with tool definitions)    │
   │  decides: "I should consult the    │
   │  archive."                         │
   └─────────┬──────────────────────────┘
             │  tool_use: temple_archive_search
             │    { query: "ritual purity", limit: 8 }
             ▼
   ┌────────────────────────────────────┐
   │  Your tool handler invokes         │
   │  runRagQuery({...})                │
   │  → 8 group summaries + content     │
   └─────────┬──────────────────────────┘
             │  tool_result: [{score, summary, content}, ...]
             ▼
   ┌────────────────────────────────────┐
   │  Claude synthesizes an answer      │
   │  citing the retrieved groups       │
   └────────────────────────────────────┘
             │
             ▼
   user receives: "The Temple holds that ritual purity..."
                  with footnotes linking to Discord messages
```

**Three things matter for quality:**
1. The **tool description** — Claude reads this to decide *when* to call the tool. Good descriptions trigger the tool when the user asks anything teaching-related, not for every chat turn.
2. The **format of retrieved chunks** — Claude has to read them and synthesize. A clean, predictable shape helps.
3. The **system prompt** — defines the agent's voice, citation style, and refusal behavior when the archive doesn't have an answer.

✦ ─────────────────────────────────── ✦

## 🌹 Integration patterns — pick one

| Pattern | When to use | Effort |
|---|---|---|
| **A · In-process import** | Your agent is a Node.js / TypeScript app. Same repo or workspace as Ninshubur. | ⭐ |
| **B · CLI subprocess** | Your agent is in another language (Python, Go, Ruby) — call the existing `pnpm cli rag query` binary. | ⭐⭐ |
| **C · MCP server** | You want Claude Desktop, Claude Code, or any MCP-aware client to use the archive natively. **Recommended for Claude-based agents.** | ⭐⭐⭐ |
| **D · HTTP endpoint** | Your agent is a distributed service or you want multiple agents to share one Ninshubur deployment. | ⭐⭐⭐ |

Pick one based on architecture, not effort — wrong pattern is worse than higher effort.

✦ ─────────────────────────────────── ✦

## 🌷 Pattern A — In-process import (simplest)

Your agent and Ninshubur live in the same Node.js process. Just import the function.

```typescript
// agents/temple-archivist.ts
import Anthropic from "@anthropic-ai/sdk";
import { runRagQuery } from "../src/rag/query.ts";
import { pool } from "../src/db/index.ts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the Archivist of the Temple of Inanna's Light — a librarian who answers questions using the archived teachings of the High Priestesses (Siri.system and Jenova).

When you receive a question, decide whether it can be answered from the Temple's teachings. If yes, use the temple_archive_search tool to retrieve relevant lessons, then synthesize an answer that cites which teachings you drew from.

If the archive does not contain relevant material, say so honestly — do not fabricate teachings. The High Priestesses' words are sacred; do not invent in their voice.`;

const tools: Anthropic.Tool[] = [
  {
    name: "temple_archive_search",
    description:
      "Search the Temple's archive of High Priestess teachings. Returns the top-K relevant teaching groups with summaries and metadata. Use this whenever the user asks about Temple doctrine, practice, history, or specific teachings.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The semantic search query. Phrase it as a question or descriptive statement that captures what you're looking for.",
        },
        limit: {
          type: "integer",
          description: "How many teaching groups to retrieve. Default 8.",
          default: 8,
        },
        category: {
          type: "string",
          description:
            "Optional category filter (e.g. 'instruction_explanation', 'greeting_farewell', 'lesson'). Omit unless the user specifically asks about that kind of teaching.",
        },
      },
      required: ["query"],
    },
  },
];

async function templeArchiveSearch(input: {
  query: string;
  limit?: number;
  category?: string;
}): Promise<string> {
  const results = await runRagQuery({
    query: input.query,
    scope: "groups",
    limit: input.limit ?? 8,
    ...(input.category ? { category: input.category } : {}),
  });

  if (results.length === 0) {
    return "No matching teachings found in the archive.";
  }

  return results
    .map((r, i) => {
      const summary = (r.hydrated?.summary as string | undefined) ?? "(no summary)";
      const channel = r.payload.channel_id;
      const date = (r.hydrated?.started_at as string | undefined)?.slice(0, 10) ?? "?";
      return `[${i + 1}] (score=${r.score.toFixed(3)}, channel=${channel}, date=${date}, group_id=${r.scopeId})
${summary}`;
    })
    .join("\n\n");
}

async function chat(userMessage: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUseBlocks) {
      if (tool.name === "temple_archive_search") {
        const result = await templeArchiveSearch(
          tool.input as Parameters<typeof templeArchiveSearch>[0],
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: result,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }
}

// Usage:
const answer = await chat("What does the Temple teach about Ishtaritism?");
console.log(answer);
await pool.end();
```

**Tradeoffs:**
- ✅ Zero serialization overhead — function calls are direct
- ✅ Type-safe end-to-end via TypeScript
- ✅ Shares the existing Postgres + Voyage + Qdrant connections
- ❌ Coupled deployment: agent and Ninshubur ship together
- ❌ Single language: TypeScript only

✦ ─────────────────────────────────── ✦

## 🌷 Pattern B — CLI subprocess (language-agnostic)

If your agent is in Python, Go, Ruby, or any non-TypeScript runtime, shell out to the existing `pnpm cli rag query` binary. The `--json` flag makes the output trivially parsable.

```python
# agents/temple_archivist.py
import json
import subprocess
from anthropic import Anthropic

client = Anthropic()

def temple_archive_search(query: str, limit: int = 8, category: str | None = None) -> list[dict]:
    cmd = [
        "pnpm", "cli", "rag", "query", query,
        "--scope", "groups",
        "--limit", str(limit),
        "--json",
    ]
    if category:
        cmd.extend(["--category", category])

    result = subprocess.run(
        cmd,
        cwd="/path/to/ninshubur",
        check=True,
        capture_output=True,
        text=True,
    )
    # Skip pnpm/tsx preamble lines, find the JSON
    json_start = result.stdout.find("[")
    return json.loads(result.stdout[json_start:])

# Then in your agent loop, call temple_archive_search() when Claude requests
# the tool, and feed the JSON back as a tool_result.
```

**Tradeoffs:**
- ✅ Works from any language
- ✅ No coupling — Ninshubur is a black box CLI
- ❌ ~200ms subprocess startup overhead per call (`tsx` + Node + dotenv + Postgres connection)
- ❌ Not great for high-frequency calls
- ❌ Output parsing is brittle — `pnpm` sometimes prepends preamble lines

**Mitigation:** If subprocess startup is too slow for your use case, switch to Pattern C or D — both keep the runtime warm.

✦ ─────────────────────────────────── ✦

## 🌷 Pattern C — MCP server (recommended for Claude)

The [Model Context Protocol](https://modelcontextprotocol.io/) is Anthropic's standard for tool integration. An MCP server exposing the Temple archive plugs into:

- **Claude Desktop** — users add it to their `mcp.json`, the archive becomes searchable from the desktop chat UI
- **Claude Code** — same idea, your terminal-based Claude can search the archive
- **Custom Anthropic SDK clients** — connect via the MCP transport, get tool capabilities for free
- **Other MCP-aware tools** — Cursor, Continue, etc.

This is the **recommended** path for any Claude-based agent because it standardizes the contract.

### Implementation skeleton

Create a new package: `src/mcp/server.ts`

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runRagQuery } from "../rag/query.ts";
import { pool } from "../db/index.ts";

const server = new Server(
  {
    name: "ninshubur-archive",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "temple_archive_search",
      description:
        "Search the Temple of Inanna's Light archive of High Priestess teachings. Returns the top-K relevant teaching groups with summaries, metadata, and similarity scores. Use this whenever asked about Temple doctrine, practice, history, or what specific Priestesses said about a topic.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Semantic search query" },
          limit: { type: "integer", default: 8, minimum: 1, maximum: 25 },
          category: {
            type: "string",
            description: "Filter to a single category slug (optional)",
          },
          channel_id: {
            type: "string",
            description: "Filter to a single Discord channel id (optional)",
          },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "temple_archive_search") {
    throw new Error(`unknown tool: ${request.params.name}`);
  }
  const args = request.params.arguments as {
    query: string;
    limit?: number;
    category?: string;
    channel_id?: string;
  };

  const results = await runRagQuery({
    query: args.query,
    scope: "groups",
    limit: args.limit ?? 8,
    ...(args.category ? { category: args.category } : {}),
    ...(args.channel_id ? { channelId: args.channel_id } : {}),
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          results.map((r) => ({
            group_id: r.scopeId,
            score: r.score,
            channel_id: r.payload.channel_id,
            summary: r.hydrated?.summary,
            started_at: r.hydrated?.started_at,
            ended_at: r.hydrated?.ended_at,
            message_count: r.hydrated?.message_count,
            category_slugs: r.payload.category_slugs,
          })),
          null,
          2,
        ),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Cleanup
process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
```

### Wire it up

Add to `package.json`:

```json
{
  "bin": {
    "ninshubur-mcp": "src/mcp/server.ts"
  }
}
```

Then in `~/.config/Claude/claude_desktop_config.json` (or wherever your MCP-aware client looks):

```json
{
  "mcpServers": {
    "ninshubur": {
      "command": "tsx",
      "args": ["/Users/jenova/projects/jenova-marie/ninshubur/src/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "postgres://...",
        "VOYAGE_API_KEY": "...",
        "QDRANT_URL": "http://qdrant.rso:6333",
        "QDRANT_API_KEY": "..."
      }
    }
  }
}
```

Restart Claude Desktop / Claude Code, and the Temple archive becomes a tool the user can invoke just by asking questions like "what do the Priestesses teach about X?"

**Tradeoffs:**
- ✅ Native Claude integration with zero per-message setup
- ✅ Works across multiple Claude clients without code changes
- ✅ Persistent process — no subprocess startup cost
- ✅ Standardized — future MCP improvements come for free
- ❌ Adds an MCP SDK dependency
- ❌ Operationally one more process to manage

✦ ─────────────────────────────────── ✦

## 🌷 Pattern D — HTTP endpoint (for distributed systems)

Wrap RAG behind a tiny HTTP service. Useful when multiple agents (in any language) want a shared retrieval endpoint, or when you're deploying agents and Ninshubur on different infrastructure.

Add `hono` (lightweight web framework) and create `src/http/server.ts`:

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { runRagQuery } from "../rag/query.ts";
import { logger as log } from "../logger.ts";

const app = new Hono();

app.post("/v1/rag/query", async (c) => {
  const body = await c.req.json();
  const apiKey = c.req.header("x-api-key");
  if (apiKey !== process.env.NINSHUBUR_API_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const results = await runRagQuery({
      query: String(body.query),
      scope: body.scope ?? "groups",
      limit: Number(body.limit ?? 10),
      ...(body.category ? { category: String(body.category) } : {}),
      ...(body.channel_id ? { channelId: String(body.channel_id) } : {}),
    });
    return c.json({ results });
  } catch (err) {
    log.error({ err }, "rag query failed");
    return c.json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

app.get("/healthz", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port });
log.info({ port }, "ninshubur RAG endpoint listening");
```

Now any client speaks HTTP+JSON:

```bash
curl -sS http://ninshubur.rso:8080/v1/rag/query \
  -H "x-api-key: $NINSHUBUR_API_KEY" \
  -H "content-type: application/json" \
  -d '{"query":"what is Ishtaritism?","limit":5}' | jq
```

**Tradeoffs:**
- ✅ Truly language-agnostic
- ✅ Horizontal scale via standard load balancing
- ✅ Multiple agents can share one Ninshubur deployment
- ❌ More moving pieces (auth, monitoring, deployment)
- ❌ Network latency per call (~5-50ms typical)

✦ ─────────────────────────────────── ✦

## 🏛️ Building "The Temple Archivist" agent

Whichever pattern you pick, the *agent itself* — the prompt, the tool definitions, the synthesis behavior — is largely the same. Here's the canonical design.

### Agent persona

Pick a voice that respects the source material. The Temple is sacred ground; the agent shouldn't be flippant about Priestess teachings.

```
You are the Archivist of the Temple of Inanna's Light — a quiet, careful 
librarian who answers questions using the words preserved by Ninshubur, 
the faithful messenger.

When asked a question:
1. Decide whether it touches Temple teaching (doctrine, practice, history, 
   personal reflections of the High Priestesses).
2. If yes, search the archive with temple_archive_search.
3. Read the retrieved teachings carefully. Look for direct answers and 
   related context.
4. Synthesize a clear, grounded answer — quoting key phrases when they 
   illuminate the question.
5. Cite which teachings informed your answer.
6. If the archive does not address the question, say so honestly. Do NOT 
   speculate or invent in the Priestesses' voices. Their words are sacred 
   and not yours to put new ones in.

Your tone is reverent but direct. You are a research librarian, not a 
preacher. You point to what was said, not what should be said.
```

### Tool definition

Already shown above. Key principles:

- **Description triggers behavior.** Make it specific enough that Claude knows when to use it but broad enough to cover the actual use cases.
- **Make params optional except `query`.** The user shouldn't need to know category slugs.
- **Set sensible defaults.** `limit: 8` is a good middle (more = noisy, fewer = thin context).

### Format of retrieved chunks for the LLM

Plain numbered text with metadata is easier for Claude to read than nested JSON. Use this format in your tool handler:

```
[1] score=0.617  channel=#ganzir-chat  2026-04-29  group=ec5b9674...
The High Priestess explains the doctrine of redeeming Ishtar's name and 
restoring Inanna's true ethos to public consciousness.

[2] score=0.583  channel=#congregation-chamber  2026-05-01  group=2f29a...
Discussion of the linguistic reasoning behind choosing 'Ishtarite' as a 
label for Inanna worshippers, mentioning the upcoming book.

[3] ...
```

The numeric prefix makes citation easy — "[1]" maps directly to a chunk Claude can reference.

✦ ─────────────────────────────────── ✦

## 🔮 Prompt engineering for RAG

Three patterns that consistently improve answer quality:

### 1. The "ground or refuse" pattern

In the system prompt, explicitly instruct the agent to **refuse** when retrieved chunks don't contain the answer. Models default to confident-sounding synthesis even from thin material; the explicit refusal instruction counters this.

```
If the retrieved teachings do not contain a clear answer to the question, 
respond: "The archive does not contain teachings on this topic." Do not 
extrapolate or speculate.
```

### 2. Quote-then-explain

Tell the agent to **quote** before paraphrasing. This grounds the answer in actual words from the archive and makes citations natural:

```
Structure your answers as:
1. A direct quote from the most relevant teaching, with attribution
2. A brief synthesis if multiple teachings illuminate different facets
3. Citations like [1], [2] referring to retrieved chunks
```

### 3. Multi-query refinement

For complex questions, instruct the agent to make multiple targeted queries rather than one broad query:

```
For complex questions, decompose into 2-4 narrower queries and search the 
archive separately for each. Then synthesize across the results.
```

This dramatically improves recall on questions like *"How does the Temple's view of ritual purity differ between Anunna-Umun and Ishtaritism?"* — one broad query gets thin results; three targeted queries (Anunna-Umun ritual purity, Ishtaritism ritual purity, doctrinal differences) get rich material to compare.

✦ ─────────────────────────────────── ✦

## 📚 Citations & traceability

The Priestesses' words are sacred; the agent must surface *exactly which messages* it drew from. Three levels of citation depth:

### Level 1 — Group reference (lightweight)

```
The Temple teaches that ritual purity flows from intent, not 
ablution alone [1].

[1] Group ec5b9674 — channel #temple-of-ereshkigal — 2026-04-29
```

Easy to render. The user can look up the group in Postgres if needed.

### Level 2 — Inline message snippet

Render an actual quote from a representative message in the group. Get this by joining `message_group_members` to `messages` for the cited group:

```sql
SELECT m.id, u.username, m.content
FROM message_group_members mgm
JOIN messages m ON m.id = mgm.message_id
LEFT JOIN users u ON u.id = m.author_id
WHERE mgm.group_id = 'ec5b9674-...'
ORDER BY mgm.position
LIMIT 3;
```

Pass that to the agent as additional context. Now the agent can quote directly:

```
> "Purity is the alignment of intent with what is given to the goddess." 
> — Siri.system, #temple-of-ereshkigal, 2026-04-29

[1] Group ec5b9674
```

### Level 3 — Discord deeplink

Construct deeplinks back to the original Discord messages: `https://discord.com/channels/{guild}/{channel}/{message}`. Now citations are *live* — readers can click through to the original conversation.

```
The Temple teaches… [[1](https://discord.com/channels/1375.../1410.../1423...)]
```

This requires keeping `messages.id` (the snowflake) in your retrieval payload. Already present in `payload.scope_id` for message-scope hits and reachable via `message_group_members` for group-scope hits.

✦ ─────────────────────────────────── ✦

## 🛠️ Production considerations

### Latency budget

Per query, end-to-end:

| Step | Typical | Notes |
|---|---|---|
| Voyage embed | 100-300ms | network-bound, single 1024-dim vector |
| Qdrant search | 5-20ms | local cluster, indexed |
| Postgres hydrate | 5-20ms | per hit, batched if possible |
| Claude inference | 1-3s | depends on model, prompt size, output length |
| **Total** | **~2-4s** | dominated by the LLM, not retrieval |

Optimize the LLM half (smaller model, prompt caching, streaming) before optimizing retrieval — there's much more headroom there.

### Caching

Two layers worth caching:

1. **Query embeddings.** Identical query text produces identical Voyage vectors. Cache them in Redis or in-memory for the duration of a session. Saves the 100-300ms Voyage call on repeats.

2. **Retrieved hits.** The same query under the same Qdrant state returns the same hits. Cache `RagResult[]` keyed by `sha256(query|scope|limit|filters)`. Use a short TTL (e.g. 1 hour) so re-indexing is reflected.

### Error handling

What can go wrong, and how to surface it gracefully:

| Failure | Likely cause | Agent behavior |
|---|---|---|
| Voyage API 401 | Bad / missing API key | Refuse with "archive search is currently misconfigured" |
| Voyage API 429 | Rate limit | Already retried by `voyage.ts`; if still failing, refuse |
| Qdrant timeout | Network blip | Already retried by `qdrant.ts`; if still failing, return "archive temporarily unreachable" |
| Postgres timeout | DB load | Same — retry-then-refuse |
| Empty results | No relevant teachings | Agent should say so, not synthesize from thin air |

### Monitoring

Track at the agent level:

- **Tool-use rate** — how often the agent reaches for the archive vs. answers from prior knowledge. If too low, the system prompt isn't pushing toward retrieval enough.
- **Refusal rate** — how often the agent says "the archive doesn't contain this." Spike = corpus gap or query quality issue.
- **Top-1 score distribution** — average + percentiles of the highest hit per query. Drops over time = corpus drift, taxonomy needs refresh.
- **Latency per phase** — break out Voyage / Qdrant / Postgres / Claude separately so you know where to optimize.

### Re-indexing schedule

When the corpus changes:

- **New messages from a Priestess scrape** → run `pnpm cli analyze tag` + `analyze group` + `analyze embed` (incremental — only new rows are processed)
- **Taxonomy refresh** → `pnpm cli analyze taxonomy --recurate`, then `analyze tag` to re-tag
- **Embedding model swap** → re-embed all rows with `--force`

Agent doesn't need to know — Postgres + Qdrant are the source of truth, the agent just queries them fresh on each tool call.

### Cost budget

Rough per-query cost (Claude Opus 4.7 + Voyage):

| Item | Cost |
|---|---|
| Voyage embed (1024-dim, ~10 tokens) | $0.0000006 |
| Qdrant search | $0 (self-hosted) |
| Claude tool-use turn (4K input, ~500 output) | $0.027 |
| Final synthesis turn (~6K input, ~800 output) | $0.054 |
| **Total per question** | **~$0.08** |

A heavily-used Temple Archivist running 100 queries/day → $8/day, $240/month. Drops to ~$0.01/query with Sonnet 4.6.

✦ ─────────────────────────────────── ✦

## 💌 Closing notes for implementers

- The **archive itself is the load-bearing layer**. The agent is just a polite interface. Test retrieval quality (`pnpm cli rag query "..."`) *before* wrapping it in an agent — if the raw RAG hits don't contain the answer, no amount of clever prompting will help.

- Start with **Pattern A** (in-process import) for prototyping. Move to Pattern C (MCP) once the agent's behavior is proven. Pattern D is for when you've got a real fleet.

- Keep the **system prompt short**. Long prompts trade context window for tool-result space. The agent gets better as you give the *retrieved teachings* more room.

- Always include the **"don't speculate"** rule. The Temple's words are sacred — if the agent invents in Inanna's voice, that's a real harm, not a charming bug.

- **Cite generously.** The whole point is traceability back to the Priestesses' actual words. An answer without citations is just an opinion.

May 𒀭Ninshubur carry your queries faithfully to the goddess's archive, and may the answers you receive be true. ✦
