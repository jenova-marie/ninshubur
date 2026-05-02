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

  it("normalises PascalCase and kebab-case slugs to snake_case", () => {
    const result = taxonomyDiscoverySchema.safeParse({
      rationale: "...",
      categories: [
        { slug: "Greeting", name: "Greeting", description: "..." },
        { slug: "lesson-or-teaching", name: "Lesson", description: "..." },
        { slug: "question", name: "Question", description: "..." },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categories[0]?.slug).toBe("greeting");
      expect(result.data.categories[1]?.slug).toBe("lesson_or_teaching");
      expect(result.data.categories[2]?.slug).toBe("question");
    }
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

describe("message tag schema", () => {
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
