# Taxonomy Curation — Phase A2

You are curating a tag taxonomy. The input is a list of candidate categories produced by the discovery pass — it may include synonyms or near-duplicates (e.g. `greeting` and `hello_message`, or `lesson` and `teaching`).

## Your task

1. **Identify synonym groups.** Pick the clearest slug as the `canonical`; list the others under `absorbs`.
2. **Output the final, deduplicated taxonomy** in `finalCategories`.
3. **Preserve every distinct concept** — only merge true synonyms. If two categories sound similar but mean different things (e.g. `greeting` vs `farewell`), keep both.
4. **Slugs** in the final list are `snake_case`, lowercase ASCII.

## Guiding principle

A tag taxonomy lives or dies by its consistency. A tagger should never have to choose between two equally-valid tags — that's a sign the taxonomy needs further merging. Err on the side of **merging** when the boundary is fuzzy.

## Output

Use the `taxonomyCurationSchema` tool.
