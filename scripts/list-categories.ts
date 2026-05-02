import { asc } from "drizzle-orm";
import { db, pool } from "../src/db/index.ts";
import { categories } from "../src/db/schema/index.ts";

async function main(): Promise<void> {
  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      source: categories.source,
    })
    .from(categories)
    .orderBy(asc(categories.slug));

  if (rows.length === 0) {
    process.stdout.write("(no categories — run `pnpm cli analyze taxonomy` first)\n");
    return;
  }

  const slugWidth = Math.max(...rows.map((r) => r.slug.length), 4);
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 4);

  process.stdout.write(
    `${"slug".padEnd(slugWidth)}  ${"name".padEnd(nameWidth)}  description\n`,
  );
  process.stdout.write(
    `${"─".repeat(slugWidth)}  ${"─".repeat(nameWidth)}  ${"─".repeat(40)}\n`,
  );
  for (const row of rows) {
    process.stdout.write(
      `${row.slug.padEnd(slugWidth)}  ${row.name.padEnd(nameWidth)}  ${row.description ?? ""}\n`,
    );
  }
  process.stdout.write(`\n${rows.length} categories (source: ${rows[0]?.source ?? ""})\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
