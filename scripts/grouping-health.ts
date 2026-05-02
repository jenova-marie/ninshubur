import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.ts";

async function header(text: string): Promise<void> {
  process.stdout.write(`\n${"━".repeat(72)}\n`);
  process.stdout.write(`  ${text}\n`);
  process.stdout.write(`${"━".repeat(72)}\n`);
}

async function main(): Promise<void> {
  // ── 1. Coverage ─────────────────────────────────────────────────
  await header("Coverage — how many messages are in groups?");
  const coverage = await db.execute(
    sql`
      SELECT
        (SELECT count(*) FROM messages
         WHERE COALESCE(NULLIF(content,''), message_snapshots->0->>'content','') <> '')
          AS messages_with_content,
        (SELECT count(*) FROM message_group_members)         AS messages_in_groups,
        (SELECT count(*) FROM message_groups)                AS group_count
    `,
  );
  for (const row of coverage.rows) {
    process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
  }

  // ── 2. Group size distribution ──────────────────────────────────
  await header("Group size distribution — bigger is better, mostly");
  const sizes = await db.execute(
    sql`
      WITH sizes AS (
        SELECT g.id, count(m.message_id) AS n
        FROM message_groups g
        LEFT JOIN message_group_members m ON m.group_id = g.id
        GROUP BY g.id
      )
      SELECT n AS group_size, count(*)::int AS group_count
      FROM sizes
      GROUP BY n
      ORDER BY n
    `,
  );
  process.stdout.write("size  count   bar\n");
  process.stdout.write("────  ─────   ───\n");
  const rows = sizes.rows as Array<{ group_size: number; group_count: number }>;
  const max = rows.reduce((acc, r) => Math.max(acc, r.group_count), 0);
  for (const row of rows) {
    const bar = "▓".repeat(Math.round((row.group_count / max) * 50));
    process.stdout.write(
      `${String(row.group_size).padStart(4)}  ${String(row.group_count).padStart(5)}   ${bar}\n`,
    );
  }

  // ── 3. Per-channel breakdown ────────────────────────────────────
  await header("Per-channel — how grouped is each tracked channel?");
  const perChannel = await db.execute(
    sql`
      SELECT
        c.name,
        c.id,
        (SELECT count(*) FROM messages m
         WHERE m.channel_id = c.id
           AND COALESCE(NULLIF(m.content,''), m.message_snapshots->0->>'content','') <> ''
        ) AS msgs,
        (SELECT count(*) FROM message_groups g WHERE g.channel_id = c.id) AS groups,
        (SELECT count(*) FROM message_group_members mgm
         JOIN message_groups g ON g.id = mgm.group_id
         WHERE g.channel_id = c.id
        ) AS msgs_in_groups,
        ROUND(
          (SELECT count(*)::numeric FROM message_group_members mgm
           JOIN message_groups g ON g.id = mgm.group_id
           WHERE g.channel_id = c.id)
          / NULLIF(
            (SELECT count(*)::numeric FROM messages m
             WHERE m.channel_id = c.id
               AND COALESCE(NULLIF(m.content,''), m.message_snapshots->0->>'content','') <> '')
          , 0)
          * 100, 1
        ) AS pct_grouped
      FROM channels c
      WHERE c.is_tracked = true
        AND EXISTS (
          SELECT 1 FROM messages m WHERE m.channel_id = c.id
        )
      ORDER BY msgs DESC
    `,
  );
  process.stdout.write("channel".padEnd(36) + "msgs   groups   in-grps   %\n");
  process.stdout.write("─".repeat(72) + "\n");
  for (const row of perChannel.rows as Array<{
    name: string;
    msgs: string | number;
    groups: string | number;
    msgs_in_groups: string | number;
    pct_grouped: string | number | null;
  }>) {
    const name = (row.name ?? "").padEnd(36).slice(0, 36);
    const msgs = String(row.msgs ?? 0).padStart(5);
    const groups = String(row.groups ?? 0).padStart(7);
    const inGrps = String(row.msgs_in_groups ?? 0).padStart(8);
    const pct =
      row.pct_grouped === null ? "  —" : `${String(row.pct_grouped)}%`.padStart(6);
    process.stdout.write(`${name}  ${msgs}  ${groups}  ${inGrps}  ${pct}\n`);
  }

  // ── 4. Sample of multi-message groups ───────────────────────────
  await header("Sample groups (>1 message) — eyeball quality");
  const samples = await db.execute(
    sql`
      WITH big AS (
        SELECT g.id, g.channel_id, g.summary, c.name AS channel_name
        FROM message_groups g
        JOIN channels c ON c.id = g.channel_id
        WHERE (SELECT count(*) FROM message_group_members WHERE group_id = g.id) >= 2
        ORDER BY random()
        LIMIT 5
      )
      SELECT
        big.id,
        big.channel_name,
        big.summary,
        (SELECT json_agg(
          json_build_object(
            'pos', mgm.position,
            'author', u.username,
            'preview', LEFT(COALESCE(NULLIF(m.content,''), m.message_snapshots->0->>'content',''), 100)
          ) ORDER BY mgm.position
         )
         FROM message_group_members mgm
         JOIN messages m ON m.id = mgm.message_id
         LEFT JOIN users u ON u.id = m.author_id
         WHERE mgm.group_id = big.id
        ) AS members
      FROM big
    `,
  );
  for (const row of samples.rows as Array<{
    id: string;
    channel_name: string;
    summary: string | null;
    members: Array<{ pos: number; author: string | null; preview: string }>;
  }>) {
    process.stdout.write(`\n📝 ${row.channel_name}\n`);
    process.stdout.write(`   summary: ${row.summary ?? "(none)"}\n`);
    for (const member of row.members ?? []) {
      process.stdout.write(
        `   [${member.pos}] ${member.author ?? "?"}: ${member.preview}\n`,
      );
    }
  }

  // ── 5. Singleton check ──────────────────────────────────────────
  await header("Singleton ratio — what fraction of groups have only 1 msg?");
  const singletons = await db.execute(
    sql`
      WITH sizes AS (
        SELECT g.id, count(m.message_id) AS n
        FROM message_groups g
        LEFT JOIN message_group_members m ON m.group_id = g.id
        GROUP BY g.id
      )
      SELECT
        count(*) FILTER (WHERE n = 1)::int AS singletons,
        count(*) FILTER (WHERE n >= 2)::int AS multi,
        count(*)::int AS total,
        ROUND(count(*) FILTER (WHERE n = 1)::numeric / NULLIF(count(*),0)::numeric * 100, 1) AS singleton_pct
      FROM sizes
    `,
  );
  for (const row of singletons.rows) {
    process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
  }

  process.stdout.write("\n");
  process.stdout.write("━".repeat(72) + "\n");
  process.stdout.write("  ✦ Heuristics for healthy grouping:\n");
  process.stdout.write("    - singleton % between 30–60%  (some msgs do stand alone)\n");
  process.stdout.write("    - average group size 1.5–3.5  (lessons exist)\n");
  process.stdout.write("    - sample summaries should READ like one-line topic descriptions\n");
  process.stdout.write("━".repeat(72) + "\n\n");
}

main()
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
