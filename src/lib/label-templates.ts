import { asc } from "drizzle-orm";
import { db } from "@/db";
import { labelTemplates } from "@/db/schema";
import { parseTemplate, templateOptions, type LabelTemplate } from "@/lib/label-template";

export type SavedLabelTemplate = { id: string; name: string; template: LabelTemplate };

// Stored templates, re-validated on the way out so a row written by an older
// version (or by hand) can't break rendering — invalid ones are skipped.
export async function loadLabelTemplates(): Promise<SavedLabelTemplate[]> {
  const rows = await db
    .select({ id: labelTemplates.id, name: labelTemplates.name, template: labelTemplates.template })
    .from(labelTemplates)
    .orderBy(asc(labelTemplates.name));
  return rows.flatMap((row) => {
    const template = parseTemplate(row.template);
    return "error" in template ? [] : [{ id: row.id, name: row.name, template }];
  });
}

/** Saved templates plus the built-ins, as offered in pickers. */
export async function loadTemplateOptions() {
  return templateOptions(await loadLabelTemplates());
}
