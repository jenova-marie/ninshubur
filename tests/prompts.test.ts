import { describe, expect, it } from "vitest";
import {
  groupWindowPrompt,
  loadPrompt,
  messageTagPrompt,
  taxonomyCurationPrompt,
  taxonomyDiscoveryPrompt,
} from "../src/prompts/index.ts";

describe("prompt loader", () => {
  it("reads markdown content from disk", () => {
    const text = loadPrompt("taxonomy-discovery");
    expect(text).toContain("Taxonomy Discovery");
    expect(text.length).toBeGreaterThan(100);
  });

  it("caches subsequent reads", () => {
    const a = loadPrompt("group-window");
    const b = loadPrompt("group-window");
    expect(a).toBe(b);
  });
});

describe("typed prompt accessors", () => {
  it("taxonomyDiscoveryPrompt resolves to the discovery markdown", () => {
    expect(taxonomyDiscoveryPrompt.system).toContain("Taxonomy Discovery");
    expect(taxonomyDiscoveryPrompt.reference).toBeUndefined();
  });

  it("taxonomyCurationPrompt resolves to the curation markdown", () => {
    expect(taxonomyCurationPrompt.system).toContain("Taxonomy Curation");
  });

  it("groupWindowPrompt resolves to the grouping markdown", () => {
    expect(groupWindowPrompt.system).toContain("Window-Batch Grouping");
  });

  it("messageTagPrompt embeds the locked taxonomy as the reference block", () => {
    const taxonomy = "- `greeting` — **Greeting**: hellos and goodbyes.";
    const prompt = messageTagPrompt(taxonomy);
    expect(prompt.system).toContain("Message Tagging");
    expect(prompt.reference).toContain("LOCKED TAXONOMY");
    expect(prompt.reference).toContain(taxonomy);
  });
});
