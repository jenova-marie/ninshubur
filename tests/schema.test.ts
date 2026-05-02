import { describe, expect, it } from "vitest";
import {
  channelInsertSchema,
  messageInsertSchema,
  threadInsertSchema,
  userInsertSchema,
} from "../src/db/validators.ts";

describe("zod schemas derived from drizzle", () => {
  it("validates a minimal user insert payload", () => {
    const result = userInsertSchema.safeParse({
      id: "123456789012345678",
      username: "ninshubur",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a thread insert without required fields", () => {
    const result = threadInsertSchema.safeParse({
      id: "123",
    });
    expect(result.success).toBe(false);
  });

  it("validates a generic channel insert payload", () => {
    const result = channelInsertSchema.safeParse({
      id: "123456789012345678",
      guildId: "111111111111111111",
      type: 0,
      name: "general",
    });
    expect(result.success).toBe(true);
  });

  it("validates a forum channel insert payload", () => {
    const result = channelInsertSchema.safeParse({
      id: "123456789012345678",
      guildId: "111111111111111111",
      type: 15,
      name: "general-help",
    });
    expect(result.success).toBe(true);
  });

  it("validates a message insert payload — text channel (no thread)", () => {
    const result = messageInsertSchema.safeParse({
      id: "999999999999999999",
      channelId: "888888888888888888",
      type: 0,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("validates a message insert payload — forum thread reply", () => {
    const result = messageInsertSchema.safeParse({
      id: "999999999999999999",
      channelId: "777777777777777777",
      threadId: "888888888888888888",
      type: 0,
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});
