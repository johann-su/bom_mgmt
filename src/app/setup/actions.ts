"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { labelTemplates, locations, locationTypes } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db-errors";
import { DEFAULT_TEMPLATES, uniqueName } from "@/lib/label-template";
import { prepareSetup, type SetupLevel } from "@/lib/setup-plan";
import { saveCodeSeparator } from "@/lib/settings";

type Result = { error?: string };

/**
 * Applies the first-run wizard in one transaction: the location types (in
 * level order), a saved copy of each chosen built-in label so it can be
 * edited per type later, the code separator, and the starting locations. Refused once any type
 * exists — the wizard is only for an empty database.
 */
export async function completeSetup(input: {
  levels: SetupLevel[];
  separator: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const valid = prepareSetup(input.levels, input.separator);
  if ("error" in valid) return valid;
  const { plan } = valid;

  try {
    const error = await db.transaction(async (tx) => {
      // Serialises concurrent submissions so the emptiness check holds.
      await tx.execute(sql`LOCK TABLE ${locationTypes} IN EXCLUSIVE MODE`);
      const existing = await tx.select({ id: locationTypes.id }).from(locationTypes).limit(1);
      if (existing.length > 0) return "Setup has already been completed";

      await saveCodeSeparator(valid.separator, tx);
      const taken = (await tx.select({ name: labelTemplates.name }).from(labelTemplates)).map(
        (t) => t.name,
      );
      const typeIds: string[] = [];
      for (const [position, level] of valid.levels.entries()) {
        const builtIn = DEFAULT_TEMPLATES[level.template];
        const name = uniqueName(`${level.name} — ${builtIn.name}`, taken);
        taken.push(name);
        const [template] = await tx
          .insert(labelTemplates)
          .values({ name, template: builtIn.template })
          .returning({ id: labelTemplates.id });
        const [type] = await tx
          .insert(locationTypes)
          .values({
            name: level.name,
            labelPattern: level.labelPattern,
            icon: level.icon,
            position,
            labelTemplateId: template.id,
          })
          .returning({ id: locationTypes.id });
        typeIds.push(type.id);
      }

      // The plan lists parents before children, so insert level by level and
      // map each planned index to the id it got.
      const ids: string[] = [];
      for (let level = 0; level < valid.levels.length; level++) {
        const batch = plan.flatMap((p, index) => (p.level === level ? [{ ...p, index }] : []));
        if (batch.length === 0) break;
        const created = await tx
          .insert(locations)
          .values(
            batch.map((p) => ({
              parentId: p.parent === null ? null : ids[p.parent],
              typeId: typeIds[level],
              label: p.label,
            })),
          )
          .returning({ id: locations.id });
        // INSERT … RETURNING yields rows in VALUES order.
        batch.forEach((p, i) => (ids[p.index] = created[i].id));
      }
      return null;
    });
    if (error) return { error };
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "Setup has already been completed" };
    throw err;
  }

  revalidatePath("/", "layout");
  return {};
}
