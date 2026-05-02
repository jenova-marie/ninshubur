// The Anthropic SDK's `zodOutputFormat()` helper calls
// `toJSONSchema` from `zod/v4`, which only understands v4-style schema
// objects (with the new `_def`/`def` shape). Our schemas need to be
// authored against the v4 surface so that helper accepts them.
//
// drizzle-zod and the rest of the project still use the v3 default
// export — mixing the two surfaces in the same package is supported
// as long as each schema is constructed against the version of `z`
// it will be consumed by.
import { z } from "zod/v4";

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "slug must be lowercase alphanumeric with underscores");

/** Phase A: discovery — Haiku proposes the tag taxonomy. */
export const taxonomyDiscoverySchema = z.object({
  rationale: z.string().describe("One paragraph: how you chose these categories."),
  categories: z
    .array(
      z.object({
        slug: slug.describe("snake_case identifier, e.g. 'greeting' or 'lesson'"),
        name: z.string().describe("Human-readable display name."),
        description: z
          .string()
          .describe("One sentence describing what messages fall in this category."),
      }),
    )
    .min(3)
    .max(40),
});

/** Phase A: curation — merge synonyms in a candidate list. */
export const taxonomyCurationSchema = z.object({
  merges: z
    .array(
      z.object({
        canonical: slug,
        absorbs: z.array(slug),
        reason: z.string(),
      }),
    )
    .describe("Synonym groups: `canonical` keeps its slug, `absorbs` are dropped."),
  finalCategories: z
    .array(
      z.object({
        slug,
        name: z.string(),
        description: z.string(),
      }),
    )
    .describe("The final, deduplicated taxonomy."),
});

/** Phase B: per-message tagging. */
export const messageTagSchema = z.object({
  categories: z
    .array(
      z.object({
        slug: slug.describe(
          "Must come from the locked taxonomy below, OR the literal '__novel__' if no category fits.",
        ),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("Subjective 0-1 confidence in this assignment."),
      }),
    )
    .min(1)
    .max(5),
  novelHint: z
    .string()
    .nullable()
    .describe("If any slug is '__novel__', describe what new category would fit."),
});

/** Phase C: window-batch grouping. */
export const groupWindowSchema = z.object({
  groups: z
    .array(
      z.object({
        startIndex: z
          .number()
          .int()
          .nonnegative()
          .describe("0-based index of the first message in this group."),
        endIndex: z
          .number()
          .int()
          .nonnegative()
          .describe("0-based index of the last message in this group (inclusive)."),
        summary: z
          .string()
          .describe("Short summary of what this group is about — one sentence."),
      }),
    )
    .describe(
      "Disjoint, contiguous, exhaustive cover of [0..messages.length-1]. Single-message groups are allowed.",
    ),
});

export type TaxonomyDiscovery = z.infer<typeof taxonomyDiscoverySchema>;
export type TaxonomyCuration = z.infer<typeof taxonomyCurationSchema>;
export type MessageTag = z.infer<typeof messageTagSchema>;
export type GroupWindow = z.infer<typeof groupWindowSchema>;
