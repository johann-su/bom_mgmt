"use server";

import { revalidatePath } from "next/cache";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, locationTypes } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { parseLabel, parsePattern } from "@/lib/label-pattern";
import { LOCATION_ICONS } from "@/lib/location-icons";
import { isUniqueViolation } from "@/lib/db-errors";

type Result = { error?: string };

function validate(input: { name: string; labelPattern: string; icon: string }) {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  const labelPattern = input.labelPattern.trim();
  const parsed = parsePattern(labelPattern);
  if ("error" in parsed) return { error: parsed.error };
  const icon = input.icon in LOCATION_ICONS ? input.icon : "box";
  return { name, labelPattern, icon, parsed };
}

function revalidate() {
  revalidatePath("/settings/location-types");
  revalidatePath("/locations", "layout");
}

export async function createLocationType(input: {
  name: string;
  labelPattern: string;
  icon: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const valid = validate(input);
  if ("error" in valid) return valid;

  const [{ value: existing }] = await db.select({ value: count() }).from(locationTypes);
  try {
    await db.insert(locationTypes).values({
      name: valid.name,
      labelPattern: valid.labelPattern,
      icon: valid.icon,
      position: existing,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `A type named "${valid.name}" already exists` };
    throw err;
  }
  revalidate();
  return {};
}

export async function updateLocationType(input: {
  id: string;
  name: string;
  labelPattern: string;
  icon: string;
}): Promise<Result> {
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

  try {
    const updated = await db
      .update(locationTypes)
      .set({ name: valid.name, labelPattern: valid.labelPattern, icon: valid.icon })
      .where(eq(locationTypes.id, input.id))
      .returning({ id: locationTypes.id });
    if (updated.length === 0) return { error: "Location type not found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `A type named "${valid.name}" already exists` };
    throw err;
  }
  revalidate();
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
