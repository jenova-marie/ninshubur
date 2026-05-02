import { Command } from "commander";
import { pool } from "../db/index.ts";
import { runRagQuery } from "../rag/query.ts";

export function registerRagCommand(program: Command): void {
  const rag = program
    .command("rag")
    .description("Retrieval-augmented queries against the embedded corpus");

  rag
    .command("query <text...>")
    .description("Embed a query and return top-K relevant groups (or messages)")
    .option("--scope <which>", "groups | messages", "groups")
    .option("--limit <n>", "How many hits to return", "10")
    .option("--category <slug>", "Filter to a single category slug")
    .option("--channel <id>", "Filter to a single channel id")
    .option("--json", "Emit JSON instead of formatted text")
    .action(
      async (
        text: string[],
        opts: {
          scope: "groups" | "messages";
          limit: string;
          category?: string;
          channel?: string;
          json?: boolean;
        },
      ) => {
        try {
          const query = text.join(" ");
          const results = await runRagQuery({
            query,
            scope: opts.scope,
            limit: Number(opts.limit),
            ...(opts.category ? { category: opts.category } : {}),
            ...(opts.channel ? { channelId: opts.channel } : {}),
          });
          if (opts.json) {
            process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
          } else if (results.length === 0) {
            process.stdout.write("(no hits)\n");
          } else {
            for (const r of results) {
              const score = r.score.toFixed(3);
              const summary =
                (r.hydrated?.summary as string | undefined) ??
                (r.hydrated?.content as string | undefined) ??
                "";
              process.stdout.write(
                `[${score}] ${r.scopeType}:${r.scopeId}\n  ${summary.slice(0, 200)}\n\n`,
              );
            }
          }
        } finally {
          await pool.end();
        }
      },
    );
}
