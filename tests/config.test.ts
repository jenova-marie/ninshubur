import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  DISCORD_TOKEN: "fake-token",
  DISCORD_CLIENT_ID: "123456789012345678",
  DISCORD_GUILD_IDS: "111111111111111111,222222222222222222",
  CHANNEL_IDS: "",
  USER_IDS: "",
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  BACKFILL_PAGE_SIZE: "50",
  ARCHIVE_SWEEP_INTERVAL_MS: "60000",
  LOG_LEVEL: "warn",
  NODE_ENV: "test",
};

const originalEnv = { ...process.env };

function setEnv(env: Record<string, string | undefined>): void {
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function loadConfig(env: Record<string, string | undefined>) {
  setEnv(env);
  vi.resetModules();
  return import("../src/config.ts");
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("env config", () => {
  it("parses valid environment variables", async () => {
    const { env } = await loadConfig(validEnv);
    expect(env.DISCORD_TOKEN).toBe("fake-token");
    expect(env.DISCORD_GUILD_IDS).toEqual([
      "111111111111111111",
      "222222222222222222",
    ]);
    expect(env.CHANNEL_IDS).toEqual([]);
    expect(env.BACKFILL_PAGE_SIZE).toBe(50);
    expect(env.ARCHIVE_SWEEP_INTERVAL_MS).toBe(60000);
  });

  it("rejects malformed snowflakes", async () => {
    await expect(
      loadConfig({ ...validEnv, DISCORD_CLIENT_ID: "not-a-snowflake" }),
    ).rejects.toThrow(/DISCORD_CLIENT_ID/);
  });

  it("rejects missing token", async () => {
    await expect(
      loadConfig({ ...validEnv, DISCORD_TOKEN: undefined }),
    ).rejects.toThrow(/DISCORD_TOKEN/);
  });
});
