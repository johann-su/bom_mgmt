// Adds attributes a newer "Generic part" wizard generates (e.g. a screw's
// "Head", used by {{attr:Head}} on labels) to parts made before, from their
// stored spec (parts.generic). Only missing keys are added; values already on
// a part, hand-edited or not, are kept. Parts whose spec is stale are skipped.
//
// Like scripts/backfill-generic.ts it reads JSON and prints SQL, so it runs
// against any instance and the SQL can be read before it's applied:
//
//   # 1. export (read-only)
//   psql "$DATABASE_URL" -At -c "select coalesce(json_agg(json_build_object(
//     'id', id, 'name', name, 'attributes', attributes, 'generic', generic)), '[]')
//     from parts where generic is not null" > parts.json
//   # 2. report on stderr, SQL on stdout
//   npx tsx scripts/backfill-generic-attributes.ts parts.json > attributes.sql
//   # 3. review attributes.sql, then apply
//   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f attributes.sql
//
// Each UPDATE only applies if the part's attributes are still what was
// exported, so an edit made in between isn't overwritten; re-running is
// harmless.

import { readFileSync } from "node:fs";
import { regenerate } from "@/lib/generic-families";
import { withMissingAttributes } from "@/lib/generic-fill";
import { parseGenericSpec } from "@/lib/generic-parts";
import type { PartAttribute } from "@/lib/part-attributes";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/backfill-generic-attributes.ts parts.json > attributes.sql");
  process.exit(1);
}
type Row = { id: string; name: string; attributes: PartAttribute[]; generic: unknown };
const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const updates: string[] = [];
const stale: string[] = [];
for (const row of rows) {
  const generated = regenerate(parseGenericSpec(row.generic));
  if (!generated) {
    stale.push(row.name);
    continue;
  }
  const next = withMissingAttributes(row.attributes, generated.attributes);
  if (!next) continue;
  const had = new Set(row.attributes.map((a) => a.key.trim().toLowerCase()));
  const added = next.filter((a) => !had.has(a.key.trim().toLowerCase())).map((a) => `${a.key}: ${a.value}`);
  console.error(`${row.name}  +  ${added.join(", ")}`);
  updates.push(
    `UPDATE parts SET attributes = ${quote(JSON.stringify(next))}::jsonb, updated_at = now() ` +
      `WHERE id = ${quote(row.id)} AND attributes = ${quote(JSON.stringify(row.attributes))}::jsonb;`,
  );
}
if (stale.length) console.error(`\nStale spec — skipped (${stale.length})\n  ${stale.join("\n  ")}`);
console.error(`\n${updates.length} of ${rows.length} parts get new attributes.`);
process.stdout.write(["BEGIN;", ...updates, "COMMIT;", ""].join("\n"));
