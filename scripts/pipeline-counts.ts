import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.ts";

async function main(): Promise<void> {
  const result = await db.execute(
    sql`
      SELECT 'messages'           AS scope, count(*) AS n FROM messages
      UNION ALL
      SELECT 'message_categories' AS scope, count(*) AS n FROM message_categories
      UNION ALL
      SELECT 'categories'         AS scope, count(*) AS n FROM categories
      UNION ALL
      SELECT 'message_groups'     AS scope, count(*) AS n FROM message_groups
      UNION ALL
      SELECT 'message_group_members' AS scope, count(*) AS n FROM message_group_members
      UNION ALL
      SELECT 'embeddings (msg)'   AS scope, count(*) AS n FROM embeddings WHERE scope_type = 'message'
      UNION ALL
      SELECT 'embeddings (group)' AS scope, count(*) AS n FROM embeddings WHERE scope_type = 'group'
      UNION ALL
      SELECT 'llm_jobs'           AS scope, count(*) AS n FROM llm_jobs
    `,
  );

  for (const row of result.rows as Array<{ scope: string; n: number | string }>) {
    process.stdout.write(`${String(row.scope).padEnd(24)} ${row.n}\n`);
  }
}

main()
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
