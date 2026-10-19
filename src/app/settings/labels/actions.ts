"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { labelTemplates, locationTypes } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/db-errors";
import { isUuid } from "@/lib/utils";
import { DEFAULT_TEMPLATES, builtInIndex, parseTemplate, uniqueName } from "@/lib/label-template";

type Result = { error?: string; id?: string };

function validate(input: { name: string; template: unknown }) {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  if (name.length > 100) return { error: "Name is too long" };
  const template = parseTemplate(input.template);
  if ("error" in template) return template;
  return { name, template };
}

function revalidate() {
  revalidatePath("/settings/labels", "layout");
  // Location pages show each location's label.
  revalidatePath("/locations", "layout");
}

async function assignToType(typeId: string, templateId: string | null) {
  await db.update(locationTypes).set({ labelTemplateId: templateId }).where(eq(locationTypes.id, typeId));
}

/**
 * Creates or updates a template. `assignToTypeId` also makes it the label of
 * that location type — how editing a built-in from a location page sticks.
 */
export async function saveLabelTemplate(input: {
  id: string | null;
  name: string;
  template: unknown;
  assignToTypeId?: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const valid = validate(input);
  if ("error" in valid) return valid;

  try {
    if (input.id) {
      const updated = await db
        .update(labelTemplates)
        .set({ name: valid.name, template: valid.template, updatedAt: new Date() })
        .where(eq(labelTemplates.id, input.id))
        .returning({ id: labelTemplates.id });
      if (updated.length === 0) return { error: "Template not found" };
      if (input.assignToTypeId) await assignToType(input.assignToTypeId, updated[0].id);
      revalidate();
      return { id: updated[0].id };
    }
    const [created] = await db
      .insert(labelTemplates)
      .values({ name: valid.name, template: valid.template })
      .returning({ id: labelTemplates.id });
    if (input.assignToTypeId) await assignToType(input.assignToTypeId, created.id);
    revalidate();
    return { id: created.id };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `A template named "${valid.name}" already exists` };
    throw err;
  }
}

export async function deleteLabelTemplate(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  await db.delete(labelTemplates).where(eq(labelTemplates.id, input.id));
  revalidate();
  return {};
}

/**
 * Picks the label for every location of a type. A built-in is copied into a
 * saved template first, so later edits from the location page have a row to
 * change without touching the built-in.
 */
export async function assignLabelTemplate(input: { typeId: string; key: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const index = builtInIndex(input.key);
  if (index === null && !isUuid(input.key)) return { error: "Unknown template" };
  if (!isUuid(input.typeId)) return { error: "Location type not found" };
  let templateId = input.key;
  if (index !== null) {
    const builtIn = DEFAULT_TEMPLATES[index];
    const taken = await db.select({ name: labelTemplates.name }).from(labelTemplates);
    const [created] = await db
      .insert(labelTemplates)
      .values({ name: uniqueName(builtIn.name, taken.map((t) => t.name)), template: builtIn.template })
      .returning({ id: labelTemplates.id });
    templateId = created.id;
  }
  try {
    const updated = await db
      .update(locationTypes)
      .set({ labelTemplateId: templateId })
      .where(eq(locationTypes.id, input.typeId))
      .returning({ id: locationTypes.id });
    if (updated.length === 0) return { error: "Location type not found" };
  } catch (err) {
    if (isForeignKeyViolation(err)) return { error: "That template no longer exists" };
    throw err;
  }
  revalidate();
  return { id: templateId };
}
