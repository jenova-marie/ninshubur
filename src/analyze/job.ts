import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { llmJobs, type LlmJob, type NewLlmJob } from "../db/schema/index.ts";
import { logger } from "../logger.ts";

export type JobKind = "taxonomy" | "tag" | "group" | "embed";

export async function startJob(
  kind: JobKind,
  params: Record<string, unknown> = {},
): Promise<LlmJob> {
  const row: NewLlmJob = { kind, status: "running", params };
  const [job] = await db.insert(llmJobs).values(row).returning();
  if (!job) throw new Error("failed to create llm_jobs row");
  logger.info({ jobId: job.id, kind, params }, "analyze job started");
  return job;
}

export async function completeJob(
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await db
    .update(llmJobs)
    .set({ status: "completed", result, finishedAt: new Date() })
    .where(sql`${llmJobs.id} = ${jobId}`);
  logger.info({ jobId, result }, "analyze job complete");
}

export async function failJob(jobId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  await db
    .update(llmJobs)
    .set({ status: "failed", error: message, finishedAt: new Date() })
    .where(sql`${llmJobs.id} = ${jobId}`);
  logger.error({ jobId, err }, "analyze job failed");
}

/** Wraps an async block with `running → completed | failed` bookkeeping. */
export async function withJob<T>(
  kind: JobKind,
  params: Record<string, unknown>,
  fn: (jobId: string) => Promise<{ result: Record<string, unknown>; value: T }>,
): Promise<T> {
  const job = await startJob(kind, params);
  try {
    const { result, value } = await fn(job.id);
    await completeJob(job.id, result);
    return value;
  } catch (err) {
    await failJob(job.id, err);
    throw err;
  }
}
