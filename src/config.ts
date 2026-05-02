import "dotenv/config";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake");

const csvSnowflakes = z
  .string()
  .default("")
  .transform((raw) =>
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )
  .pipe(z.array(snowflake));

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_GUILD_IDS: csvSnowflakes,
  CHANNEL_IDS: csvSnowflakes,
  USER_IDS: csvSnowflakes,
  DATABASE_URL: z.string().url(),
  BACKFILL_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  ARCHIVE_SWEEP_INTERVAL_MS: z.coerce.number().int().min(60_000).default(900_000),

  // ── LLM analysis pipeline ────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  VOYAGE_API_KEY: z.string().optional().default(""),
  VOYAGE_MODEL: z.string().default("voyage-3.5"),
  QDRANT_URL: z.string().url().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional().default(""),
  QDRANT_COLLECTION_MESSAGES: z.string().default("ninshubur_messages"),
  QDRANT_COLLECTION_GROUPS: z.string().default("ninshubur_groups"),
  ANALYZE_BATCH_DEFAULT: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env: Env = parsed.data;
