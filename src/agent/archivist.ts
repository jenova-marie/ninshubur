import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { env } from "../config.ts";
import { logger } from "../logger.ts";
import { loadPrompt } from "../prompts/index.ts";
import { runRagQuery } from "../rag/query.ts";

/**
 * The Archivist — a two-model agent that answers questions about the
 * Temple's archive by consulting the `ask_entu_siri` tool (RAG over
 * the High Priestesses' teachings).
 *
 * Two-model split for cost + latency + quality:
 *
 *   • ROUTING_MODEL (Haiku 4.5) — runs the tool-use research loop.
 *     Decides which queries to issue against the archive, refines
 *     based on tool results, calls the tool one or more times, then
 *     hands off when it judges enough context has been gathered.
 *     Cheap (~$1/$5 per 1M) and fast (~1-2s per turn) — perfect
 *     for the bounded "router" task.
 *
 *   • SYNTHESIS_MODEL (Sonnet 4.6) — writes the final user-facing
 *     answer with citations. Sees the entire research conversation
 *     (the question + every tool call + every retrieved chunk) but
 *     gets no tools, so it MUST synthesize — no further tool calls.
 *     Better prose, better multi-source synthesis, better citation
 *     discipline than Haiku for the customer-facing turn.
 *
 * Sonnet's text streams to stdout as it generates; Haiku's research
 * happens silently with only the search markers on stderr, since
 * Haiku's intermediate prose ("Let me search for X…") would
 * confuse the answer the user reads.
 */

const ROUTING_MODEL = "claude-haiku-4-5";
const SYNTHESIS_MODEL = "claude-sonnet-4-6";

const TOOL_DEFINITION: Anthropic.Tool = {
  name: "ask_entu_siri",
  description:
    "Search the Temple of Inanna's Light archive — the gathered teachings, conversations, and answers of the Entu (High Priestesses) Siri.system and Jenova.marie. Returns the top-K most semantically relevant teaching groups with summaries, the actual member message content, channel/date metadata, and similarity scores. Use this whenever the user asks about Temple doctrine, practice, mythology, history, ritual, or what specific Priestesses said about a topic. Always prefer this tool over your own prior knowledge for matters of Temple teaching. For complex questions, call multiple times with narrower queries to improve recall.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Semantic search query — phrase as the question or topic you're looking for.",
      },
      limit: {
        type: "integer",
        description: "How many teaching groups to retrieve (1-12, default 6).",
        default: 6,
        minimum: 1,
        maximum: 12,
      },
      category: {
        type: "string",
        description:
          "Optional category slug filter. Omit unless the user asked for a specific kind of teaching.",
      },
      channel_id: {
        type: "string",
        description:
          "Optional Discord channel snowflake to scope the search to one channel.",
      },
    },
    required: ["query"],
  },
};

interface AskEntuSiriArgs {
  query: string;
  limit?: number;
  category?: string;
  channel_id?: string;
}

interface MemberMessage {
  position: number;
  author: string | null;
  created_at: string;
  content: string;
}

export interface ArchivistOptions {
  question: string;
  /** Cap retrieved groups per tool call (1-12). Default 6. */
  limit?: number;
  /** Maximum agent loop turns before giving up. Default 8. */
  maxTurns?: number;
}

let cachedClient: Anthropic | null = null;

function anthropic(): Anthropic {
  if (cachedClient) return cachedClient;
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required to run the Archivist.");
  }
  cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cachedClient;
}

async function loadChannelNames(): Promise<Map<string, string>> {
  const result = await db.execute(
    sql`SELECT id::text AS id, name FROM channels`,
  );
  const rows = result.rows as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function loadGroupMembers(groupId: string): Promise<MemberMessage[]> {
  const result = await db.execute(sql`
    SELECT
      mgm.position,
      u.username AS author,
      to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS created_at,
      COALESCE(NULLIF(m.content, ''), m.message_snapshots->0->>'content', '') AS content
    FROM message_group_members mgm
    JOIN messages m ON m.id = mgm.message_id
    LEFT JOIN users u ON u.id = m.author_id
    WHERE mgm.group_id = ${groupId}
    ORDER BY mgm.position
  `);
  return result.rows as unknown as MemberMessage[];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Format a list of RagResult into the human-and-Claude-readable text
 * block that the agent consumes via tool_result. Pulls actual member
 * message content (Level 2 citations) so the agent can quote
 * Priestess words directly. Member-message lookups run in parallel
 * — sequential serialised them before, costing ~150ms per tool call.
 */
async function executeAskEntuSiri(
  args: AskEntuSiriArgs,
  channelNames: Map<string, string>,
): Promise<string> {
  const limit = Math.min(12, Math.max(1, args.limit ?? 6));
  const queryOpts: Parameters<typeof runRagQuery>[0] = {
    query: args.query,
    scope: "groups",
    limit,
  };
  if (args.category) queryOpts.category = args.category;
  if (args.channel_id) queryOpts.channelId = args.channel_id;

  const results = await runRagQuery(queryOpts);

  if (results.length === 0) {
    return "No matching teachings found in the archive.";
  }

  // Parallelise the per-result member fetches — they're independent
  // SQL queries against the same connection pool.
  const memberLookups = await Promise.all(
    results.map((r) =>
      loadGroupMembers(r.scopeId).catch((err) => {
        logger.warn(
          { err, groupId: r.scopeId },
          "failed to load group members for citation",
        );
        return [] as MemberMessage[];
      }),
    ),
  );

  const blocks: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const members = memberLookups[i] ?? [];
    if (!r) continue;

    const channelId = String(r.payload.channel_id ?? "?");
    const channel = channelNames.get(channelId) ?? channelId;
    const summary =
      (r.hydrated?.summary as string | undefined) ?? "(no summary)";
    const startedAt =
      (r.hydrated?.started_at as string | Date | undefined) ?? null;
    const date =
      typeof startedAt === "string"
        ? startedAt.slice(0, 10)
        : startedAt instanceof Date
          ? startedAt.toISOString().slice(0, 10)
          : "?";

    const memberLines =
      members.length > 0
        ? members
            .map(
              (m) =>
                `  ${m.position + 1}. ${m.author ?? "?"} ${m.created_at}: ${truncate(m.content, 280)}`,
            )
            .join("\n")
        : "  (member messages unavailable)";

    blocks.push(
      `[${i + 1}] score=${r.score.toFixed(3)} channel=#${channel} date=${date} group=${r.scopeId}
Summary: ${summary}
Messages:
${memberLines}`,
    );
  }
  return blocks.join("\n\n");
}

export interface ArchivistResult {
  answer: string;
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export async function runArchivist(
  opts: ArchivistOptions,
): Promise<ArchivistResult> {
  const client = anthropic();
  const channelNames = await loadChannelNames();
  const systemPrompt = loadPrompt("archivist");
  const maxTurns = opts.maxTurns ?? 8;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: opts.question },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  let turn = 0;
  let answer = "";

  // ── Phase 1 — Research loop with Haiku ──────────────────────────
  //
  // Haiku decides which queries to fire against the archive and may
  // refine across multiple turns. Each turn either issues tool_use
  // blocks (we execute, append results, loop) or emits end_turn
  // (Haiku judges the gathered context sufficient, hand off to
  // Sonnet for synthesis). Haiku's text output is intentionally
  // suppressed — its intermediate "I'll search for X next" prose
  // would distract from the actual answer Sonnet writes.
  while (turn < maxTurns) {
    turn += 1;

    const response = await client.messages.create({
      model: ROUTING_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: [TOOL_DEFINITION],
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      // Haiku is done researching — it produced a synthesis of its
      // own that we discard; Sonnet writes the actual answer below.
      break;
    }

    if (response.stop_reason !== "tool_use") {
      logger.warn(
        { stop_reason: response.stop_reason },
        "haiku research turn stopped unexpectedly",
      );
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUseBlocks) {
      if (tool.name !== "ask_entu_siri") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: `unknown tool: ${tool.name}`,
          is_error: true,
        });
        continue;
      }
      const args = tool.input as AskEntuSiriArgs;
      toolCalls += 1;
      process.stderr.write(`\x1b[2m🔍 ${args.query}\x1b[0m\n`);
      const result = await executeAskEntuSiri(args, channelNames);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // ── Phase 2 — Synthesis with Sonnet ─────────────────────────────
  //
  // Sonnet sees the entire research conversation (question + tool
  // calls + retrieved chunks) and writes the final answer. We pass
  // NO tools: this forces synthesis (Sonnet can't decide to call
  // more tools, which would be expensive and unnecessary at this
  // point). Stream so the user sees prose appear word-by-word.
  const stream = client.messages.stream({
    model: SYNTHESIS_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  stream.on("text", (delta) => {
    process.stdout.write(delta);
  });

  const finalMessage = await stream.finalMessage();
  inputTokens += finalMessage.usage.input_tokens;
  outputTokens += finalMessage.usage.output_tokens;

  process.stdout.write("\n");

  const textBlocks = finalMessage.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  answer = textBlocks.map((b) => b.text).join("\n\n");

  return {
    answer,
    turns: turn + 1, // +1 for the Sonnet synthesis turn
    toolCalls,
    inputTokens,
    outputTokens,
  };
}
