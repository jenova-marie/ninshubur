import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.ts", () => ({
  env: {
    DISCORD_TOKEN: "x",
    DISCORD_CLIENT_ID: "111111111111111111",
    DISCORD_GUILD_IDS: [],
    CHANNEL_IDS: [],
    USER_IDS: [],
    DATABASE_URL: "postgres://localhost/x",
    BACKFILL_PAGE_SIZE: 100,
    ARCHIVE_SWEEP_INTERVAL_MS: 900000,
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  },
}));

vi.mock("../src/db/index.ts", () => ({
  db: {} as unknown,
  pool: { end: vi.fn().mockResolvedValue(undefined) },
  schema: {},
}));

vi.mock("../src/bot/client.ts", () => ({
  startBot: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("../src/scraper/channels.ts", () => ({
  backfillChannel: vi.fn(),
  backfillForumChannel: vi.fn(),
  backfillTextChannel: vi.fn(),
  backfillThread: vi.fn(),
}));

vi.mock("../src/scraper/store.ts", () => ({
  upsertGuild: vi.fn(),
  upsertChannel: vi.fn(),
}));

// The analyze tree pulls in @anthropic-ai/sdk, voyageai, and the
// Qdrant client. None of those should be hit during CLI parser tests,
// and voyageai has an ESM directory-import bug that crashes Node when
// loaded. Stub the leaf modules.
vi.mock("../src/analyze/taxonomy.ts", () => ({ runTaxonomy: vi.fn() }));
vi.mock("../src/analyze/tag.ts", () => ({ runTag: vi.fn() }));
vi.mock("../src/analyze/group.ts", () => ({ runGroup: vi.fn() }));
vi.mock("../src/analyze/embed.ts", () => ({ runEmbed: vi.fn() }));
vi.mock("../src/rag/query.ts", () => ({ runRagQuery: vi.fn() }));
vi.mock("../src/agent/archivist.ts", () => ({ runArchivist: vi.fn() }));

let buildProgram: typeof import("../src/cli.ts").buildProgram;

beforeAll(async () => {
  ({ buildProgram } = await import("../src/cli.ts"));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("cli program", () => {
  it("exposes the expected subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((cmd) => cmd.name()).sort();
    expect(names).toEqual([
      "analyze",
      "ask",
      "backfill",
      "channels",
      "health",
      "migrate",
      "query",
      "rag",
      "reset",
      "start",
    ]);
  });

  it("parses ask <question...> with --limit and --max-turns", () => {
    const program = buildProgram();
    program.exitOverride();
    const ask = program.commands.find((c) => c.name() === "ask")!;
    ask.action(() => {});
    program.parse([
      "node",
      "ninshubur",
      "ask",
      "what",
      "is",
      "Ishtaritism",
      "?",
      "--limit",
      "8",
      "--max-turns",
      "5",
    ]);
    const opts = ask.opts<{ limit: string; maxTurns: string }>();
    expect(opts.limit).toBe("8");
    expect(opts.maxTurns).toBe("5");
    expect(ask.args).toEqual(["what", "is", "Ishtaritism", "?"]);
  });

  it("exposes the expected analyze subcommands", () => {
    const program = buildProgram();
    const analyze = program.commands.find((c) => c.name() === "analyze")!;
    const names = analyze.commands.map((cmd) => cmd.name()).sort();
    expect(names).toEqual(["embed", "group", "status", "tag", "taxonomy"]);
  });

  it("requires --yes on reset", () => {
    const program = buildProgram();
    program.exitOverride();
    const reset = program.commands.find((c) => c.name() === "reset")!;
    reset.action(() => {});
    program.parse(["node", "ninshubur", "reset", "--yes"]);
    expect(reset.opts<{ yes?: boolean }>().yes).toBe(true);
  });

  it("exposes the expected query subcommands", () => {
    const program = buildProgram();
    const query = program.commands.find((c) => c.name() === "query")!;
    const names = query.commands.map((cmd) => cmd.name()).sort();
    expect(names).toEqual([
      "daily",
      "mentions",
      "messages",
      "replies",
      "wordcount",
    ]);
  });

  it("parses channels --json --all", () => {
    const program = buildProgram();
    program.exitOverride();
    const channels = program.commands.find((c) => c.name() === "channels")!;
    channels.action(() => {});
    program.parse(["node", "ninshubur", "channels", "--json", "--all"]);
    const opts = channels.opts<{ json?: boolean; all?: boolean }>();
    expect(opts.json).toBe(true);
    expect(opts.all).toBe(true);
  });

  it("accepts --no-backfill on the start command", () => {
    const program = buildProgram();
    program.exitOverride();
    const start = program.commands.find((c) => c.name() === "start")!;
    start.action(() => {});
    program.parse(["node", "ninshubur", "start", "--no-backfill"]);
    expect(start.opts<{ backfill: boolean }>().backfill).toBe(false);
  });

  it("parses backfill --thread", () => {
    const program = buildProgram();
    program.exitOverride();
    const backfill = program.commands.find((c) => c.name() === "backfill")!;
    backfill.action(() => {});
    program.parse([
      "node",
      "ninshubur",
      "backfill",
      "--thread",
      "999999999999999999",
    ]);
    expect(backfill.opts<{ thread?: string }>().thread).toBe(
      "999999999999999999",
    );
  });

  it("parses backfill --reset", () => {
    const program = buildProgram();
    program.exitOverride();
    const backfill = program.commands.find((c) => c.name() === "backfill")!;
    backfill.action(() => {});
    program.parse([
      "node",
      "ninshubur",
      "backfill",
      "--channel",
      "999999999999999999",
      "--reset",
    ]);
    const opts = backfill.opts<{ reset?: boolean; channel?: string }>();
    expect(opts.reset).toBe(true);
    expect(opts.channel).toBe("999999999999999999");
  });

  it("supports a --log-level override at the root", () => {
    const program = buildProgram();
    program.exitOverride();
    program.commands.forEach((c) => c.action(() => {}));
    program.parse(["node", "ninshubur", "--log-level", "debug", "start"]);
    expect(program.opts<{ logLevel?: string }>().logLevel).toBe("debug");
  });

  it("rejects unknown --log-level values", () => {
    const program = buildProgram();
    program.exitOverride();
    expect(() =>
      program.parse(["node", "ninshubur", "--log-level", "yelling", "start"]),
    ).toThrow();
  });
});
