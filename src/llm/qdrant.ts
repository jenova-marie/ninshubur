import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config.ts";
import { logger } from "../logger.ts";

/**
 * Retry budget for transient Qdrant network failures. Long embed
 * runs occasionally hit `SocketError: other side closed`, idle
 * connection drops, brief 5xx blips, etc. — same shape as the
 * retry logic already in `voyage.ts` and `haiku.ts`.
 */
const QDRANT_MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableQdrantError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Undici / Node socket errors
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("other side closed")) return true;
  if (msg.includes("socket")) return true;
  if (msg.includes("econnreset")) return true;
  if (msg.includes("etimedout")) return true;
  if (msg.includes("ehostunreach")) return true;
  if (msg.includes("eai_again")) return true;
  // Qdrant client surfaces HTTP errors with `.status` populated
  const status = (err as { status?: number }).status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  return false;
}

/**
 * Wrap a Qdrant client call with exponential-backoff retry on
 * transient network/server errors. Non-transient errors (4xx other
 * than 429, schema mismatches, auth failures) propagate immediately.
 */
async function withQdrantRetry<T>(
  description: string,
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= QDRANT_MAX_RETRIES || !isRetryableQdrantError(err)) {
        throw err;
      }
      attempt += 1;
      const waitMs =
        Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
      const status = (err as { status?: number }).status;
      logger.warn(
        {
          description,
          attempt,
          waitMs,
          status,
          message: err instanceof Error ? err.message : String(err),
        },
        `qdrant ${description} retrying after ${Math.round(waitMs / 1000)}s`,
      );
      await sleep(waitMs);
    }
  }
}

/**
 * Fixed UUID namespace for converting Discord snowflakes into
 * Qdrant-compatible point IDs. Qdrant only accepts an unsigned int or
 * a UUID for `point.id`, but Discord snowflakes are 64-bit unsigned
 * ints whose values exceed `Number.MAX_SAFE_INTEGER`, so we can't
 * pass them as JS numbers. Deterministic UUIDv5 from the snowflake
 * gives us:
 *   - same snowflake → same UUID (idempotent re-embed)
 *   - no collisions (SHA-1 over a 64-bit input)
 *   - reverse lookup via the bookkeeping `embeddings` table OR by
 *     storing the original id in the Qdrant payload as `scope_id`.
 */
const SNOWFLAKE_NAMESPACE = "f7e1b9c4-1234-5678-9abc-def012345678";

/**
 * Convert a Discord snowflake (or any string) into a deterministic
 * UUIDv5 suitable as a Qdrant point id.
 */
export function snowflakeToPointId(snowflake: string): string {
  const nsBytes = Buffer.from(SNOWFLAKE_NAMESPACE.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(snowflake, "utf8");
  const hash = createHash("sha1").update(Buffer.concat([nsBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // Version 5 (top 4 bits of byte 6 = 0101)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  // RFC 4122 variant (top 2 bits of byte 8 = 10)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

let client: QdrantClient | null = null;

export function qdrant(): QdrantClient {
  if (client) return client;
  client = new QdrantClient({
    url: env.QDRANT_URL,
    ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
  });
  return client;
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/**
 * Idempotent collection bootstrap. Creates the collection with the
 * given vector size if it doesn't exist; otherwise verifies that the
 * existing collection matches.
 *
 * Each individual API call is retry-wrapped so a transient socket
 * drop doesn't kill a long-running embed pass on the first hop.
 */
export async function ensureCollection(
  name: string,
  vectorSize: number,
): Promise<void> {
  const c = qdrant();
  const existing = await withQdrantRetry(`collectionExists(${name})`, () =>
    c.collectionExists(name),
  );
  if (existing.exists) {
    const info = await withQdrantRetry(`getCollection(${name})`, () =>
      c.getCollection(name),
    );
    const params = info.config?.params?.vectors;
    const size =
      typeof params === "object" && params && "size" in params
        ? (params.size as number)
        : null;
    if (size !== null && size !== vectorSize) {
      throw new Error(
        `qdrant collection ${name} exists with vector size ${size}, expected ${vectorSize}`,
      );
    }
    return;
  }

  await withQdrantRetry(`createCollection(${name})`, () =>
    c.createCollection(name, {
      vectors: { size: vectorSize, distance: "Cosine" },
    }),
  );
  logger.info({ collection: name, vectorSize }, "qdrant collection created");
}

/**
 * Push (upsert) a batch of points to a collection. Qdrant's `upsert`
 * is idempotent — same id replaces the existing point — so retrying
 * after a partial failure is safe.
 */
export async function upsertPoints(
  collection: string,
  points: QdrantPoint[],
): Promise<void> {
  if (points.length === 0) return;
  await withQdrantRetry(`upsert(${collection}, ${points.length} points)`, () =>
    qdrant().upsert(collection, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    }),
  );
}

export interface SearchOptions {
  collection: string;
  vector: number[];
  limit?: number;
  filter?: Record<string, unknown>;
  withPayload?: boolean;
}

export async function search(opts: SearchOptions) {
  return withQdrantRetry(`search(${opts.collection})`, () =>
    qdrant().search(opts.collection, {
      vector: opts.vector,
      limit: opts.limit ?? 10,
      with_payload: opts.withPayload ?? true,
      ...(opts.filter ? { filter: opts.filter } : {}),
    }),
  );
}
