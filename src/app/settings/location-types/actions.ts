"use server";

import { revalidatePath } from "next/cache";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, locationTypeChildren, locationTypes } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { parseLabel, parsePattern } from "@/lib/label-pattern";
import { describeAll, duplicateCodes, validateSeparator } from "@/lib/location-tree";
import { loadLocations, loadLocationTypes } from "@/lib/locations";
import { getCodeSeparator, saveCodeSeparator } from "@/lib/settings";
import {
  ambiguityError,
  findAmbiguity,
  grammarViolations,
  observedChildTypes,
  SELF_TYPE,
  type GrammarType,
} from "@/lib/code-grammar";
import { LOCATION_ICONS } from "@/lib/location-icons";
import { isUniqueViolation } from "@/lib/db-errors";

type Result = { error?: string };

type TypeInput = {
  name: string;
  labelPattern: string;
  icon: string;
  // Child types it may hold; null = any. May include SELF_TYPE.
  childTypeIds: string[] | null;
};

function validate(input: TypeInput) {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  const labelPattern = input.labelPattern.trim();
  const parsed = parsePattern(labelPattern);
  if ("error" in parsed) return { error: parsed.error };
  const icon = input.icon in LOCATION_ICONS ? input.icon : "box";
  const childTypeIds = Array.isArray(input.childTypeIds)
    ? [...new Set(input.childTypeIds.filter((id): id is string => typeof id === "string"))]
    : null;
  return { name, labelPattern, icon, parsed, childTypeIds };
}

// Refuses a type grammar under which some code would have two readings. (The
// type dialog runs the same check live and suggests patterns; this is the
// server-side guarantee.)
async function grammarError(types: GrammarType[]): Promise<string | null> {
  const separator = await getCodeSeparator();
  const ambiguity = findAmbiguity(types, separator);
  return ambiguity && ambiguityError(ambiguity, separator);
}

// A grammar change must admit every location that already exists.
function changeError(all: Awaited<ReturnType<typeof loadLocations>>, next: GrammarType[]) {
  const violations = grammarViolations(all, next);
  return violations.length > 0
    ? `Existing locations don't fit (${violations.slice(0, 3).join(", ")}) — move them out first`
    : null;
}

// Replaces a type's child list; null lifts the restriction.
async function saveChildren(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  typeId: string,
  childTypeIds: string[] | null,
) {
  await tx
    .update(locationTypes)
    .set({ restrictChildren: childTypeIds !== null })
    .where(eq(locationTypes.id, typeId));
  await tx.delete(locationTypeChildren).where(eq(locationTypeChildren.parentTypeId, typeId));
  if (childTypeIds && childTypeIds.length > 0) {
    await tx
      .insert(locationTypeChildren)
      .values(childTypeIds.map((childTypeId) => ({ parentTypeId: typeId, childTypeId })));
  }
}

function revalidate() {
  revalidatePath("/settings/location-types");
  revalidatePath("/locations", "layout");
}

// `at` places the new type on the canvas (where a link was dropped).
export async function createLocationType(
  input: TypeInput & { at?: { x: number; y: number } },
): Promise<Result & { id?: string }> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const valid = validate(input);
  if ("error" in valid) return valid;

  const types = await loadLocationTypes();
  const known = new Set([SELF_TYPE, ...types.map((t) => t.id)]);
  const childTypeIds = valid.childTypeIds?.filter((id) => known.has(id)) ?? null;
  const error = await grammarError([
    ...types,
    { id: SELF_TYPE, name: valid.name, labelPattern: valid.labelPattern, childTypeIds },
  ]);
  if (error) return { error };

  const at =
    input.at && Number.isFinite(input.at.x) && Number.isFinite(input.at.y) ? input.at : null;
  try {
    const id = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(locationTypes)
        .values({
          name: valid.name,
          labelPattern: valid.labelPattern,
          icon: valid.icon,
          position: types.length,
          canvasX: at?.x,
          canvasY: at?.y,
        })
        .returning({ id: locationTypes.id });
      const children = childTypeIds?.map((id) => (id === SELF_TYPE ? created.id : id)) ?? null;
      await saveChildren(tx, created.id, children);
      return created.id;
    });
    revalidate();
    return { id };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `A type named "${valid.name}" already exists` };
    throw err;
  }
}

export async function updateLocationType(input: TypeInput & { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const valid = validate(input);
  if ("error" in valid) return valid;

  // Changing the pattern must not strand existing labels: every location of
  // this type has to still fit, or the user renames them first.
  const members = await db
    .select({ label: locations.label })
    .from(locations)
    .where(eq(locations.typeId, input.id));
  const misfits = members.filter((m) => !parseLabel(valid.parsed, m.label));
  if (misfits.length > 0) {
    const sample = misfits.slice(0, 3).map((m) => `"${m.label}"`).join(", ");
    return {
      error: `${misfits.length} existing location label(s) don't fit the new pattern (${sample}) — rename them first`,
    };
  }

  // The new child list must admit what's already inside, and keep codes
  // unambiguous under the new pattern.
  const [types, all] = await Promise.all([loadLocationTypes(), loadLocations()]);
  if (!types.some((t) => t.id === input.id)) return { error: "Location type not found" };
  const known = new Set(types.map((t) => t.id));
  const childTypeIds = valid.childTypeIds?.filter((id) => known.has(id)) ?? null;
  const next = types.map((t) =>
    t.id === input.id
      ? { ...t, name: valid.name, labelPattern: valid.labelPattern, childTypeIds }
      : t,
  );
  const error = changeError(all, next) ?? (await grammarError(next));
  if (error) return { error };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(locationTypes)
        .set({ name: valid.name, labelPattern: valid.labelPattern, icon: valid.icon })
        .where(eq(locationTypes.id, input.id));
      await saveChildren(tx, input.id, childTypeIds);
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `A type named "${valid.name}" already exists` };
    throw err;
  }
  revalidate();
  return {};
}

/**
 * Sets only which types `id` may hold — the canvas's links. Checked like an
 * edit in the dialog: existing locations must fit, codes must stay readable.
 */
export async function setTypeChildren(input: {
  id: string;
  childTypeIds: string[] | null;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const [types, all] = await Promise.all([loadLocationTypes(), loadLocations()]);
  if (!types.some((t) => t.id === input.id)) return { error: "Location type not found" };
  const known = new Set(types.map((t) => t.id));
  const childTypeIds = Array.isArray(input.childTypeIds)
    ? [...new Set(input.childTypeIds)].filter((id) => known.has(id))
    : null;
  const next = types.map((t) => (t.id === input.id ? { ...t, childTypeIds } : t));
  const error = changeError(all, next) ?? (await grammarError(next));
  if (error) return { error };

  await db.transaction((tx) => saveChildren(tx, input.id, childTypeIds));
  revalidate();
  return {};
}

/** Saves where types sit on the canvas (after a drag or a tidy-up). */
export async function saveTypePositions(input: {
  positions: { id: string; x: number; y: number }[];
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const positions = input.positions.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  await db.transaction(async (tx) => {
    for (const p of positions) {
      await tx
        .update(locationTypes)
        .set({ canvasX: p.x, canvasY: p.y })
        .where(eq(locationTypes.id, p.id));
    }
  });
  // Positions are only drawn on this page; no need to refresh the location views.
  revalidatePath("/settings/location-types");
  return {};
}

export async function deleteLocationType(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const [{ value: used }] = await db
    .select({ value: count() })
    .from(locations)
    .where(eq(locations.typeId, input.id));
  if (used > 0) return { error: `${used} location(s) still use this type` };
  await db.delete(locationTypes).where(eq(locationTypes.id, input.id));
  revalidate();
  return {};
}

// Moves a type one step up or down; the order decides how mixed siblings sort
// and the order of the "add" menu.
export async function moveLocationType(input: { id: string; direction: -1 | 1 }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  await db.transaction(async (tx) => {
    const types = await tx
      .select({ id: locationTypes.id })
      .from(locationTypes)
      .orderBy(asc(locationTypes.position), asc(locationTypes.name));
    const index = types.findIndex((t) => t.id === input.id);
    const target = index + input.direction;
    if (index === -1 || target < 0 || target >= types.length) return;
    [types[index], types[target]] = [types[target], types[index]];
    for (const [position, t] of types.entries()) {
      await tx.update(locationTypes).set({ position }).where(eq(locationTypes.id, t.id));
    }
  });
  revalidate();
  return {};
}

/**
 * Changes what joins labels into codes, for every location at once. Refused
 * when some code could have two readings (1›11 and 11›1 without a
 * separator), since codes are how bins are searched and read off labels.
 *
 * Without a separator only a type grammar keeps codes readable, so turning it
 * off narrows every unrestricted type to the child types it holds today.
 * Restrictions stay when a separator comes back; they can be lifted per type.
 */
export async function updateCodeSeparator(input: { separator: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const valid = validateSeparator(input.separator);
  if ("error" in valid) return valid;
  const [all, types] = await Promise.all([loadLocations(), loadLocationTypes()]);

  const observed = observedChildTypes(all);
  const narrowed = valid.separator === "" ? types.filter((t) => t.childTypeIds === null) : [];
  const grammar = types.map((t) =>
    narrowed.includes(t) ? { ...t, childTypeIds: observed.get(t.id) ?? [] } : t,
  );
  const ambiguity = findAmbiguity(grammar, valid.separator);
  if (ambiguity) return { error: ambiguityError(ambiguity, valid.separator) };

  // Implied by the grammar check for a tree that follows the grammar; kept as
  // a guard against one that doesn't.
  const dupes = duplicateCodes(describeAll(all, valid.separator).map((l) => l.code));
  if (dupes.length > 0) {
    const sample = dupes.slice(0, 3).map((c) => `"${c}"`).join(", ");
    return { error: `Several locations would share a code (${sample}) — keep a separator` };
  }
  await db.transaction(async (tx) => {
    await saveCodeSeparator(valid.separator, tx);
    for (const t of narrowed) await saveChildren(tx, t.id, observed.get(t.id) ?? []);
  });
  // Codes show up on nearly every page (pickers, stock lists, labels).
  revalidatePath("/", "layout");
  return {};
}
