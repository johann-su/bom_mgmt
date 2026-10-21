"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, isNull, count } from "drizzle-orm";
import { db } from "@/db";
import { locations, locationTypes, stock } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { nextLabels, parseLabel, parsePattern, type ParsedPattern } from "@/lib/label-pattern";
import { subtreeIds } from "@/lib/location-tree";
import { isUniqueViolation } from "@/lib/db-errors";

type Result = { error?: string };

const MAX_BULK = 200;

async function typePattern(typeId: string): Promise<ParsedPattern | { error: string }> {
  const type = await db.query.locationTypes.findFirst({
    where: eq(locationTypes.id, typeId),
    columns: { labelPattern: true, name: true },
  });
  if (!type) return { error: "Location type not found" };
  const parsed = parsePattern(type.labelPattern);
  return "error" in parsed ? { error: `The ${type.name} pattern is invalid: ${parsed.error}` } : parsed;
}

// Labels are unique among all siblings (not per type), so "next free label"
// has to skip the ones other types already use here.
function siblingFilter(parentId: string | null) {
  return parentId ? eq(locations.parentId, parentId) : isNull(locations.parentId);
}

function revalidate() {
  revalidatePath("/locations", "layout");
  revalidatePath("/parts", "layout");
}

/**
 * Creates locations under `parentId` (null = top level). With a `label` it
 * creates that one location, validated against the type's pattern; without,
 * it creates `count` locations with the next free labels — "add 12 bins".
 */
export async function createLocations(input: {
  parentId: string | null;
  typeId: string;
  label?: string;
  name?: string;
  count?: number;
}): Promise<Result & { ids?: string[] }> {
  if (!(await getSession())) return { error: "You must be signed in" };

  const pattern = await typePattern(input.typeId);
  if ("error" in pattern) return pattern;

  if (input.parentId) {
    const parent = await db.query.locations.findFirst({
      where: eq(locations.id, input.parentId),
      columns: { id: true },
    });
    if (!parent) return { error: "Parent location not found" };
  }

  let labels: string[];
  if (input.label !== undefined && input.label.trim() !== "") {
    const label = input.label.trim();
    if (!parseLabel(pattern, label)) {
      return { error: `"${label}" doesn't fit the pattern ${pattern.source}` };
    }
    labels = [label];
  } else {
    const wanted = Math.min(Math.max(1, Math.floor(input.count ?? 1)), MAX_BULK);
    const siblings = await db
      .select({ label: locations.label })
      .from(locations)
      .where(siblingFilter(input.parentId));
    labels = nextLabels(pattern, siblings.map((s) => s.label), wanted);
    if (labels.length === 0) return { error: `No labels left in the pattern ${pattern.source}` };
  }

  try {
    const created = await db
      .insert(locations)
      .values(
        labels.map((label) => ({
          parentId: input.parentId,
          typeId: input.typeId,
          label,
          // A name only makes sense for a single location.
          name: labels.length === 1 ? (input.name ?? "").trim() : "",
        })),
      )
      .returning({ id: locations.id });
    revalidate();
    return { ids: created.map((c) => c.id) };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `${labels[0]} already exists here` };
    throw err;
  }
}

export async function updateLocation(input: {
  id: string;
  label: string;
  name: string;
  description: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, input.id),
    columns: { typeId: true },
  });
  if (!location) return { error: "Location not found" };

  const pattern = await typePattern(location.typeId);
  if ("error" in pattern) return pattern;
  const label = input.label.trim();
  if (!parseLabel(pattern, label)) return { error: `"${label}" doesn't fit the pattern ${pattern.source}` };

  try {
    await db
      .update(locations)
      .set({
        label,
        name: input.name.trim(),
        description: input.description.trim(),
        updatedAt: new Date(),
      })
      .where(eq(locations.id, input.id));
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `A sibling is already labeled ${label}` };
    throw err;
  }
  revalidate();
  return {};
}

// Re-parents a location (with its whole subtree and contents). Refuses moves
// into itself or its own descendants, which would cut the subtree loose.
export async function moveLocation(input: { id: string; parentId: string | null }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const all = await db.select({ id: locations.id, parentId: locations.parentId }).from(locations);
  if (!all.some((l) => l.id === input.id)) return { error: "Location not found" };
  if (input.parentId) {
    if (!all.some((l) => l.id === input.parentId)) return { error: "Target location not found" };
    if (subtreeIds(all, input.id).has(input.parentId)) {
      return { error: "Can't move a location into itself or one of its children" };
    }
  }
  try {
    await db
      .update(locations)
      .set({ parentId: input.parentId, updatedAt: new Date() })
      .where(eq(locations.id, input.id));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "The target already has a location with this label — relabel first" };
    }
    throw err;
  }
  revalidate();
  return {};
}

// Deletes an empty location. Anything still inside (child locations or
// stock) has to be moved out first, so nothing vanishes by accident; the
// part's zero-quantity "home" rows here are dropped with it.
export async function deleteLocation(input: { id: string }): Promise<Result & { parentId?: string | null }> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, input.id),
    columns: { parentId: true },
  });
  if (!location) return { error: "Location not found" };

  const [{ value: children }] = await db
    .select({ value: count() })
    .from(locations)
    .where(eq(locations.parentId, input.id));
  if (children > 0) return { error: `It still contains ${children} location(s)` };

  const [{ value: stocked }] = await db
    .select({ value: count() })
    .from(stock)
    .where(and(eq(stock.locationId, input.id), gt(stock.quantity, 0)));
  if (stocked > 0) return { error: `It still holds stock of ${stocked} part(s) — move it first` };

  await db.transaction(async (tx) => {
    await tx.delete(stock).where(eq(stock.locationId, input.id));
    await tx.delete(locations).where(eq(locations.id, input.id));
  });
  revalidate();
  return { parentId: location.parentId };
}
