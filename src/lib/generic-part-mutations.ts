// Generic-part writes (src/lib/generic-parts.ts), shared by the "Generic
// part" dialog's server action and the MCP tools. Like part-mutations.ts,
// callers authenticate first; parts are generated here from the spec, never
// taken from the caller, so every generic part has the wizard's format.
// Kept out of part-mutations.ts because it needs part-import.ts, which
// imports that module.

import { inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { categories, parts } from "@/db/schema";
import { suggestCategory } from "@/lib/category-suggest";
import { generateRange, specFor, type GeneratedPart, type GenericType, type GenericValues } from "@/lib/generic-parts";
import { ensureCategories } from "@/lib/part-import";
import { createPart, type MutationResult } from "@/lib/part-mutations";

type PartRef = { id: string; name: string };

export type GenericCreateResult = MutationResult & {
  created?: PartRef[];
  /** Generated parts that already exist (same name or MPN), left as they are. */
  existing?: PartRef[];
  /** With dryRun: the parts that would be created. */
  planned?: GeneratedPart[];
  /** The category the new parts go in (an existing one, or created). */
  category?: string | null;
};

/**
 * Creates one generic part per range value — a screw per length, a housing
 * per pin count — filed under an existing matching category or a new one,
 * each with its spec stored (parts.generic). Parts that already exist (same
 * name or MPN) are skipped and returned in `existing`, so re-running a range
 * only adds what's new. Generic parts are bulk commodities, kept as a level;
 * `initialLocationId` + `initialLevel` ("Plenty") stock each new part.
 */
export async function createGenericParts(
  userId: string,
  input: {
    family: string;
    type: GenericType;
    values: GenericValues;
    range: string[];
    dryRun?: boolean;
    initialLocationId?: string | null;
    initialLevel?: string;
  },
): Promise<GenericCreateResult> {
  const generated = generateRange(input.type, input.values, input.range);
  if ("error" in generated) return generated;

  const lower = (values: string[]) => values.filter(Boolean).map((v) => v.toLowerCase());
  const names = lower(generated.map(({ part }) => part.name));
  const mpns = lower(generated.map(({ part }) => part.mpn));
  const found = await db
    .select({ id: parts.id, name: parts.name, mpn: parts.mpn })
    .from(parts)
    .where(
      or(
        inArray(sql`lower(${parts.name})`, names),
        mpns.length ? inArray(sql`lower(${parts.mpn})`, mpns) : undefined,
      ),
    );
  const taken = new Map<string, PartRef>();
  for (const p of found) {
    for (const key of lower([p.name, p.mpn])) taken.set(key, { id: p.id, name: p.name });
  }
  const match = (part: GeneratedPart) =>
    taken.get(part.name.toLowerCase()) ?? (part.mpn ? taken.get(part.mpn.toLowerCase()) : undefined);
  const existing = generated.flatMap(({ part }) => match(part) ?? []);
  const fresh = generated.filter(({ part }) => !match(part));
  if (fresh.length === 0) return { created: [], existing, planned: [] };

  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories);
  const suggestion = suggestCategory(fresh[0].part.category, cats);
  const categoryName = !suggestion
    ? null
    : "id" in suggestion
      ? (cats.find((c) => c.id === suggestion.id)?.name ?? null)
      : suggestion.name;
  if (input.dryRun) {
    return { created: [], existing, planned: fresh.map(({ part }) => part), category: categoryName };
  }

  let categoryId: string | null = null;
  if (suggestion && "id" in suggestion) categoryId = suggestion.id;
  else if (suggestion) {
    const ids = await db.transaction((tx) => ensureCategories(tx, [suggestion.name]));
    categoryId = ids.get(suggestion.name.toLowerCase()) ?? null;
    revalidatePath("/settings/categories");
  }

  const created: PartRef[] = [];
  for (const { part, values } of fresh) {
    const result = await createPart(userId, {
      ...part,
      categoryId,
      tracking: "level",
      generic: specFor(input.family, input.type, values),
      initialLocationId: input.initialLocationId ?? null,
      initialQuantity: input.initialLevel ?? "",
    });
    if (result.error || !result.id) return { error: result.error ?? "Could not create the part", created, existing };
    created.push({ id: result.id, name: part.name });
  }
  return { created, existing, category: categoryName };
}
