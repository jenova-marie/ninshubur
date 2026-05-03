import { Command } from "commander";
import { pool } from "../db/index.ts";
import { runArchivist } from "../agent/archivist.ts";

export function registerAskCommand(program: Command): void {
  program
    .command("ask <question...>")
    .description(
      "Ask the Archivist a question about the Temple's archive. Haiku 4.5 runs the tool-use research loop (cheap, fast); Sonnet 4.6 writes the final answer (better prose, better citations). Grounded in the High Priestesses' actual teachings via `ask_entu_siri`, with [N] citations.",
    )
    .option(
      "--limit <n>",
      "Default number of teaching groups to retrieve per archive call (1-12)",
      "6",
    )
    .option(
      "--max-turns <n>",
      "Maximum agent loop turns before giving up",
      "8",
    )
    .action(
      async (
        question: string[],
        opts: { limit: string; maxTurns: string },
      ) => {
        const text = question.join(" ").trim();
        if (!text) {
          process.stderr.write(
            "Usage: pnpm cli ask <your question>\n",
          );
          process.exit(2);
        }
        try {
          // The agent streams Claude's prose to stdout as it's generated,
          // so we don't print `result.answer` here (would double-print).
          // Just emit the telemetry footer on stderr after the loop ends.
          const result = await runArchivist({
            question: text,
            limit: Number(opts.limit),
            maxTurns: Number(opts.maxTurns),
          });
          process.stderr.write(
            `\n\x1b[2m─── ${result.turns} turn${result.turns === 1 ? "" : "s"} · ${result.toolCalls} archive call${result.toolCalls === 1 ? "" : "s"} · ${result.inputTokens} in / ${result.outputTokens} out tokens ───\x1b[0m\n`,
          );
        } finally {
          await pool.end();
        }
      },
    );
}
