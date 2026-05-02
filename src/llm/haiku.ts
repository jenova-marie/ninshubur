import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// `zod/v4` matches the version the Anthropic SDK's `zodOutputFormat`
// helper consumes. Schemas authored against `zod/v4` flow through
// `structured()` and `messages.parse()` end-to-end.
import type { z } from "zod/v4";
import { env } from "../config.ts";
import { logger } from "../logger.ts";

let client: Anthropic | null = null;

/**
 * Lazy Anthropic client. Constructed on first use so that commands
 * which don't touch Haiku (e.g. `pnpm cli channels`) keep working
 * with a blank `ANTHROPIC_API_KEY`.
 */
export function anthropic(): Anthropic {
  if (client) return client;
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for analysis commands. Set it in .env.",
    );
  }
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export interface CachedPrompt {
  /** System content; the last block gets `cache_control: ephemeral`. */
  system: string;
  /**
   * Optional taxonomy / reference block appended to the system content.
   * Kept separate so we can document its caching behaviour.
   */
  reference?: string;
}

/**
 * Build a system-prompt array with the cache breakpoint on the final
 * block. `tools` and `system` render before `messages`, so anchoring
 * the breakpoint here means every taggable message benefits.
 *
 * Note: Haiku 4.5 requires a ≥4096-token prefix to actually cache. If
 * the combined system + reference text falls under that, the request
 * just won't cache (no error, `cache_creation_input_tokens` will be
 * 0). Verify via `usage.cache_read_input_tokens` after the second
 * call in a run.
 */
export function buildSystemBlocks(prompt: CachedPrompt): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [{ type: "text", text: prompt.system }];
  if (prompt.reference) {
    blocks.push({ type: "text", text: prompt.reference });
  }
  const last = blocks[blocks.length - 1];
  if (last) last.cache_control = { type: "ephemeral" };
  return blocks;
}

export interface StructuredCallOptions<T extends z.ZodTypeAny> {
  system: CachedPrompt;
  user: string;
  schema: T;
  /** Override per-call. Defaults to env.ANTHROPIC_MODEL. */
  model?: string;
  maxTokens?: number;
}

/**
 * Anthropic occasionally returns "Grammar compilation timed out"
 * (400) on the first request that uses a new structured-output
 * schema — the server-side grammar compiler hits its timeout. The
 * compiled grammar is then cached for 24h, so retrying after a brief
 * wait almost always succeeds. We also retry on other transient 5xx
 * errors here.
 */
const STRUCTURED_RETRY_LIMIT = 4;

function isRetryableStructuredError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status >= 500) return true;
  if (err.status === 429) return true;
  // 400 Grammar compilation timeout — server-side, transient
  if (err.status === 400 && /grammar compilation/i.test(err.message)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One Haiku call → parsed Zod-typed response.
 *
 * Wraps `client.messages.parse()` + `zodOutputFormat()` with our
 * cached-system-block layout. Throws if the response doesn't match
 * the schema. Retries transient server-side errors (5xx, 429, and
 * "Grammar compilation timed out" 400s) with exponential backoff.
 */
export async function structured<T extends z.ZodTypeAny>(
  opts: StructuredCallOptions<T>,
): Promise<{ data: z.infer<T>; usage: Anthropic.Usage }> {
  let attempt = 0;
  while (true) {
    try {
      const response = await anthropic().messages.parse({
        model: opts.model ?? env.ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens ?? 4096,
        system: buildSystemBlocks(opts.system),
        messages: [{ role: "user", content: opts.user }],
        // `zodOutputFormat` is typed against zod v3 in the SDK but
        // its implementation imports `toJSONSchema` from `zod/v4`,
        // so the runtime accepts v4 schemas. Cast through `unknown`
        // to silence the mismatched signature.
        output_config: { format: zodOutputFormat(opts.schema as unknown as never) },
      });

      if (!response.parsed_output) {
        const stop = response.stop_reason ?? "unknown";
        throw new Error(`Haiku response failed to parse against schema (stop_reason=${stop})`);
      }

      if (
        response.usage.cache_read_input_tokens === 0 &&
        response.usage.cache_creation_input_tokens === 0
      ) {
        logger.trace(
          { tokens: response.usage.input_tokens },
          "haiku request had no cache hit — system prefix may be under the 4096-token minimum",
        );
      }

      return { data: response.parsed_output as z.infer<T>, usage: response.usage };
    } catch (err) {
      if (attempt < STRUCTURED_RETRY_LIMIT && isRetryableStructuredError(err)) {
        attempt += 1;
        const waitMs = Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
        const message = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number }).status;
        logger.warn(
          { attempt, waitMs, status, message },
          `haiku structured call retrying after ${Math.round(waitMs / 1000)}s`,
        );
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Submit a batch of structured calls to the Anthropic Message Batches
 * API. Returns the batch object; the caller polls `batches.retrieve`
 * and consumes results via `batches.results`.
 *
 * ~50% cheaper than sync calls but async — most batches finish within
 * an hour, max 24h.
 */
export async function submitStructuredBatch<T extends z.ZodTypeAny>(args: {
  system: CachedPrompt;
  schema: T;
  requests: Array<{ customId: string; user: string }>;
  model?: string;
  maxTokens?: number;
}): Promise<Anthropic.Messages.Batches.MessageBatch> {
  const systemBlocks = buildSystemBlocks(args.system);
  const format = zodOutputFormat(args.schema as unknown as never);
  return anthropic().messages.batches.create({
    requests: args.requests.map((req) => ({
      custom_id: req.customId,
      params: {
        model: args.model ?? env.ANTHROPIC_MODEL,
        max_tokens: args.maxTokens ?? 4096,
        system: systemBlocks,
        messages: [{ role: "user", content: req.user }],
        output_config: { format },
      },
    })),
  });
}

export async function pollBatch(
  batchId: string,
  intervalMs = 60_000,
): Promise<Anthropic.Messages.Batches.MessageBatch> {
  let batch = await anthropic().messages.batches.retrieve(batchId);
  while (batch.processing_status !== "ended") {
    logger.info(
      {
        batchId,
        processing: batch.request_counts.processing,
        succeeded: batch.request_counts.succeeded,
        errored: batch.request_counts.errored,
      },
      "batch in flight",
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    batch = await anthropic().messages.batches.retrieve(batchId);
  }
  return batch;
}
