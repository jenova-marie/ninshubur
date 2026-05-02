import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CachedPrompt } from "../llm/haiku.ts";

/**
 * Prompt loader.
 *
 * Each phase's system prompt lives as a markdown file in this folder
 * so the Temple's Priestesses can edit it without touching TypeScript.
 * The loader reads the file relative to its own location, so this
 * works under `tsx`, `node`, and inside the Docker image (the .md
 * files ship alongside the .ts files in `src/prompts/`).
 *
 * To add a new prompt:
 *   1. Drop a `<slug>.md` file in this folder.
 *   2. Add a typed export below that calls `loadPrompt("<slug>")`.
 *   3. Import it from your phase code.
 */

const PROMPTS_DIR = dirname(fileURLToPath(import.meta.url));

const cache = new Map<string, string>();

/**
 * Read a prompt's raw markdown content. Cached after first read so
 * the file is only hit once per process.
 */
export function loadPrompt(slug: string): string {
  const cached = cache.get(slug);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(PROMPTS_DIR, `${slug}.md`), "utf-8");
  cache.set(slug, text);
  return text;
}

/** Phase A1 — discover candidate categories from a sample of messages. */
export const taxonomyDiscoveryPrompt: CachedPrompt = {
  get system(): string {
    return loadPrompt("taxonomy-discovery");
  },
} as CachedPrompt;

/** Phase A2 — merge synonyms into the locked taxonomy. */
export const taxonomyCurationPrompt: CachedPrompt = {
  get system(): string {
    return loadPrompt("taxonomy-curation");
  },
} as CachedPrompt;

/** Phase C — window-batch grouping. */
export const groupWindowPrompt: CachedPrompt = {
  get system(): string {
    return loadPrompt("group-window");
  },
} as CachedPrompt;

/**
 * Phase B — per-message tagging.
 *
 * The locked taxonomy goes into the cached `reference` block, kept
 * separate from the system prompt so changes to either invalidate
 * the cache independently. Render-order is `tools` → `system` →
 * `messages`, and the breakpoint sits on the last `system` block, so
 * both blocks land inside the cache prefix.
 */
export function messageTagPrompt(taxonomyMarkdown: string): CachedPrompt {
  return {
    system: loadPrompt("message-tag"),
    reference: `## LOCKED TAXONOMY (v1)\n\n${taxonomyMarkdown}`,
  };
}
