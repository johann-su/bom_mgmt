// Fills parts.generic for parts made with the "Generic part" wizard before it
// stored the choice, so "Edit generic part" (and MCP update_part's `generic`)
// works on them. Matching is in src/lib/generic-backfill.ts.
//
// It reads parts from a JSON file and prints SQL, rather than talking to a
// database, so it can run against any instance (the production image has no
// tsx) and the SQL can be read before it's applied:
//
//   # 1. export (read-only); after migration 0012 add `where generic is null`
//   psql "$DATABASE_URL" -At -c "select coalesce(json_agg(json_build_object(
//     'id', id, 'name', name, 'mpn', mpn, 'manufacturer', manufacturer)), '[]')
//     from parts" > parts.json
//   # 2. match: report on stderr, SQL on stdout
//   npx tsx scripts/backfill-generic.ts parts.json > backfill.sql
//   # 3. review backfill.sql, then apply (needs migration 0012)
//   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backfill.sql
//
// Each UPDATE only fills a part whose generic is still null, so re-running is
// harmless. Parts nothing matches (made by hand) and ambiguous ones are listed
// and left alone.

import { readFileSync } from "node:fs";
import { allCombinations, backfillSql, matchGenericPart, type BackfillPart } from "@/lib/generic-backfill";
import type { GenericSpec } from "@/lib/generic-parts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/backfill-generic.ts parts.json > backfill.sql");
  process.exit(1);
}
const parts = JSON.parse(readFileSync(file, "utf8")) as BackfillPart[];
const combinations = allCombinations();

const matched: { id: string; spec: GenericSpec }[] = [];
const lines: Record<string, string[]> = { exact: [], mpn: [], ambiguous: [], none: [] };
for (const part of parts) {
  const match = matchGenericPart(part, combinations);
  if (match.kind === "exact" || match.kind === "mpn") {
    matched.push({ id: part.id, spec: match.spec });
    const values = Object.entries(match.spec.values).map(([k, v]) => `${k}=${v}`).join(" ");
    const renamed = match.kind === "mpn" ? `  (wizard would name it "${match.generated.name}")` : "";
    lines[match.kind].push(`${part.name}  →  ${match.spec.type} ${values}${renamed}`);
  } else if (match.kind === "ambiguous") {
    lines.ambiguous.push(`${part.name}  →  ${match.specs.map((s) => `${s.type} ${JSON.stringify(s.values)}`).join(" | ")}`);
  } else {
    lines.none.push(part.name);
  }
}

const section = (title: string, list: string[]) =>
  console.error(`\n${title} (${list.length})${list.length ? "\n  " + list.join("\n  ") : ""}`);
section("Matched exactly", lines.exact);
section("Matched by MPN + manufacturer (name differs)", lines.mpn);
section("Ambiguous — left alone", lines.ambiguous);
section("No match — not a wizard part, left alone", lines.none);
console.error(`\n${matched.length} of ${parts.length} parts get a spec.`);
process.stdout.write(backfillSql(matched));
