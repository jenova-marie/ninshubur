import { describe, expect, it } from "vitest";
import {
  groupWindowSchema,
  messageTagSchema,
  taxonomyCurationSchema,
  taxonomyDiscoverySchema,
} from "../src/analyze/schema.ts";

describe("taxonomy schemas", () => {
  it("accepts a well-formed discovery payload", () => {
    const result = taxonomyDiscoverySchema.safeParse({
      rationale: "Picked broad purpose categories.",
      categories: [
        { slug: "greeting", name: "Greeting", description: "Hello/goodbye." },
        { slug: "lesson", name: "Lesson", description: "Teaching content." },
        { slug: "question", name: "Question", description: "User asking a question." },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects fewer than 3 categories", () => {
    const result = taxonomyDiscoverySchema.safeParse({
      rationale: "...",
      categories: [
        { slug: "greeting", name: "Greeting", description: "..." },
        { slug: "lesson", name: "Lesson", description: "..." },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts PascalCase and kebab-case slugs (normalised in code, not the schema)", () => {
    const result = taxonomyDiscoverySchema.safeParse({
      rationale: "...",
      categories: [
        { slug: "Greeting", name: "Greeting", description: "..." },
        { slug: "lesson-or-teaching", name: "Lesson", description: "..." },
        { slug: "question", name: "Question", description: "..." },
      ],
    });
    // Schema accepts the broader set without transforming — the
    // canonicalisation to snake_case happens in normalizeSlug() at
    // persist + lookup time so the JSON Schema sent to Anthropic
    // stays representable.
    expect(result.success).toBe(true);
  });

  it("rejects slugs with truly invalid characters", () => {
    const result = taxonomyDiscoverySchema.safeParse({
      rationale: "...",
      categories: [
        { slug: "has spaces", name: "Spaces", description: "..." },
        { slug: "lesson", name: "Lesson", description: "..." },
        { slug: "question", name: "Question", description: "..." },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("normalizeSlug folds casing and hyphens into snake_case", async () => {
    const { normalizeSlug } = await import("../src/analyze/schema.ts");
    expect(normalizeSlug("Greeting")).toBe("greeting");
    expect(normalizeSlug("lesson-or-teaching")).toBe("lesson_or_teaching");
    expect(normalizeSlug("News-From-Lapis-Dais")).toBe("news_from_lapis_dais");
    expect(normalizeSlug("__novel__")).toBe("__novel__");
    expect(normalizeSlug("already_snake")).toBe("already_snake");
  });

  it("accepts a curation payload with merges", () => {
    const result = taxonomyCurationSchema.safeParse({
      merges: [{ canonical: "greeting", absorbs: ["salutation"], reason: "synonyms" }],
      finalCategories: [
        { slug: "greeting", name: "Greeting", description: "..." },
        { slug: "lesson", name: "Lesson", description: "..." },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("buildMessageTagSchema (runtime enum)", () => {
  it("accepts only slugs from the locked taxonomy plus __novel__", async () => {
    const { buildMessageTagSchema } = await import("../src/analyze/schema.ts");
    const schema = buildMessageTagSchema(["greeting_farewell", "lesson"]);

    expect(
      schema.safeParse({
        categories: [{ slug: "greeting_farewell", confidence: 0.9 }],
        novelHint: null,
      }).success,
    ).toBe(true);

    expect(
      schema.safeParse({
        categories: [{ slug: "__novel__", confidence: 0.5 }],
        novelHint: "feels like an apology",
      }).success,
    ).toBe(true);

    expect(
      schema.safeParse({
        categories: [{ slug: "gratitude", confidence: 0.8 }],
        novelHint: null,
      }).success,
    ).toBe(false);
  });

  it("throws if the taxonomy is empty", async () => {
    const { buildMessageTagSchema } = await import("../src/analyze/schema.ts");
    expect(() => buildMessageTagSchema([])).toThrow(/empty taxonomy/);
  });

  it("dedupes when __novel__ is somehow already in the input", async () => {
    const { buildMessageTagSchema } = await import("../src/analyze/schema.ts");
    expect(() =>
      buildMessageTagSchema(["greeting", "lesson", "__novel__"]),
    ).not.toThrow();
  });
});

describe("message tag schema (static, regex-based)", () => {
  it("accepts 1..5 categories with confidence", () => {
    const result = messageTagSchema.safeParse({
      categories: [
        { slug: "greeting", confidence: 0.95 },
        { slug: "personality", confidence: 0.4 },
      ],
      novelHint: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the __novel__ escape hatch", () => {
    const result = messageTagSchema.safeParse({
      categories: [{ slug: "__novel__", confidence: 0.7 }],
      novelHint: "feels like a meta-comment about the bot itself",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty category lists", () => {
    const result = messageTagSchema.safeParse({
      categories: [],
      novelHint: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    const result = messageTagSchema.safeParse({
      categories: [{ slug: "greeting", confidence: 2 }],
      novelHint: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("group window schema", () => {
  it("accepts valid breakpoints", () => {
    const result = groupWindowSchema.safeParse({
      groups: [
        { startIndex: 0, endIndex: 2, summary: "Greeting exchange." },
        { startIndex: 3, endIndex: 5, summary: "Lesson on Ishtar." },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative indexes", () => {
    const result = groupWindowSchema.safeParse({
      groups: [{ startIndex: -1, endIndex: 0, summary: "..." }],
    });
    expect(result.success).toBe(false);
  });
});
