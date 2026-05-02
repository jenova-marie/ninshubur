import { Command } from "commander";
import { sql, type SQL } from "drizzle-orm";
import { db, pool } from "../db/index.ts";

type Row = Record<string, unknown>;

export function registerQueryCommand(program: Command): void {
  const query = program
    .command("query")
    .description("Pre-built read-only queries against the message store");

  query
    .command("messages")
    .description("Chronological text content for a channel")
    .requiredOption("-c, --channel <id>", "Channel id")
    .option("--limit <n>", "Limit to the most recent N messages")
    .option("--json", "Emit JSON instead of a formatted table")
    .action(async (opts: { channel: string; limit?: string; json?: boolean }) => {
      const limit = opts.limit ? Number(opts.limit) : null;
      await runAndPrint(
        sql`
          SELECT
            to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at,
            content
          FROM messages
          WHERE channel_id = ${opts.channel}
          ORDER BY created_at
          ${limit ? sql`OFFSET GREATEST(0, (SELECT count(*) FROM messages WHERE channel_id = ${opts.channel}) - ${limit})` : sql``}
        `,
        opts.json,
      );
    });

  query
    .command("wordcount")
    .description("Per-author message + character counts for a channel")
    .requiredOption("-c, --channel <id>", "Channel id")
    .option("--json", "Emit JSON instead of a formatted table")
    .action(async (opts: { channel: string; json?: boolean }) => {
      await runAndPrint(
        sql`
          SELECT
            u.username,
            count(*)::int                            AS msgs,
            sum(length(m.content))::int              AS total_chars,
            round(avg(length(m.content)))::int       AS avg_chars
          FROM messages m
          JOIN users u ON u.id = m.author_id
          WHERE m.channel_id = ${opts.channel}
          GROUP BY u.username
          ORDER BY msgs DESC
        `,
        opts.json,
      );
    });

  query
    .command("replies")
    .description("Conversation threads — replies grouped under their parent message")
    .requiredOption("-c, --channel <id>", "Channel id")
    .option("--json", "Emit JSON instead of a formatted table")
    .action(async (opts: { channel: string; json?: boolean }) => {
      await runAndPrint(
        sql`
          SELECT
            m.id,
            m.referenced_message_id AS reply_to,
            u.username,
            left(m.content, 80) AS body
          FROM messages m
          JOIN users u ON u.id = m.author_id
          WHERE m.channel_id = ${opts.channel}
          ORDER BY COALESCE(m.referenced_message_id, m.id), m.created_at
        `,
        opts.json,
      );
    });

  query
    .command("daily")
    .description("Daily message counts per author for a channel")
    .requiredOption("-c, --channel <id>", "Channel id")
    .option("--json", "Emit JSON instead of a formatted table")
    .action(async (opts: { channel: string; json?: boolean }) => {
      await runAndPrint(
        sql`
          SELECT
            to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            u.username,
            count(*)::int AS msgs
          FROM messages m
          JOIN users u ON u.id = m.author_id
          WHERE m.channel_id = ${opts.channel}
          GROUP BY day, u.username
          ORDER BY day, u.username
        `,
        opts.json,
      );
    });

  query
    .command("mentions")
    .description("Messages in a channel that mention a specific user")
    .requiredOption("-c, --channel <id>", "Channel id")
    .requiredOption("-u, --user <id>", "User id to search for in mentions")
    .option("--json", "Emit JSON instead of a formatted table")
    .action(async (opts: { channel: string; user: string; json?: boolean }) => {
      await runAndPrint(
        sql`
          SELECT
            m.id,
            to_char(m.created_at, 'YYYY-MM-DD HH24:MI') AS at,
            u.username AS author,
            left(m.content, 80) AS body
          FROM messages m
          LEFT JOIN users u ON u.id = m.author_id
          WHERE m.channel_id = ${opts.channel}
            AND m.mentioned_user_ids ? ${opts.user}
          ORDER BY m.created_at
        `,
        opts.json,
      );
    });
}

async function runAndPrint(query: SQL, asJson: boolean | undefined): Promise<void> {
  try {
    const result = await db.execute(query);
    const rows = result.rows as Row[];
    if (asJson) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    } else if (rows.length === 0) {
      process.stdout.write("(no rows)\n");
    } else {
      process.stdout.write(`${formatTable(rows)}\n`);
    }
  } finally {
    await pool.end();
  }
}

/**
 * Render an array of objects as an aligned ASCII table. Long string
 * values are truncated to keep the table readable in a terminal.
 */
function formatTable(rows: Row[]): string {
  const MAX_COL_WIDTH = 90;
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) return "(no rows)";

  const stringified = rows.map((row) =>
    Object.fromEntries(
      columns.map((col) => [col, formatCell(row[col], MAX_COL_WIDTH)]),
    ),
  );

  const widths: Record<string, number> = {};
  for (const col of columns) {
    widths[col] = col.length;
  }
  for (const row of stringified) {
    for (const col of columns) {
      const width = (row[col] ?? "").length;
      if (width > (widths[col] ?? 0)) widths[col] = width;
    }
  }

  const pad = (text: string, col: string): string =>
    text.padEnd(widths[col] ?? 0);

  const header = columns.map((col) => pad(col, col)).join("  ");
  const sep = columns.map((col) => "─".repeat(widths[col] ?? 0)).join("  ");
  const body = stringified
    .map((row) => columns.map((col) => pad(row[col] ?? "", col)).join("  "))
    .join("\n");

  return `${header}\n${sep}\n${body}\n(${rows.length} row${rows.length === 1 ? "" : "s"})`;
}

function formatCell(value: unknown, max: number): string {
  if (value === null || value === undefined) return "";
  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }
  str = str.replace(/\n/g, " ");
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}
