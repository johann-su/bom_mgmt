// Ids for the references a part body may use: a category by id (checked, so
// an unknown one is a 400 rather than a foreign-key 500) or by name, created
// on first use like the spreadsheet importer and the MCP tools do.

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { ensureCategories } from "@/lib/part-import";
import { categoryExists } from "./queries";

/** `categoryId` undefined = the body names no category; null = none. */
export async function resolveCategory(body: {
  categoryId?: string | null;
  categoryName?: string;
}): Promise<{ categoryId?: string | null } | { error: string }> {
  if (body.categoryName !== undefined) {
    const name = body.categoryName.trim().slice(0, 200);
    if (!name) return { error: "categoryName is blank" };
    const ids = await db.transaction((tx) => ensureCategories(tx, [name]));
    revalidatePath("/settings/categories");
    return { categoryId: ids.get(name.toLowerCase()) ?? null };
  }
  if (!body.categoryId) return { categoryId: body.categoryId };
  return (await categoryExists(body.categoryId))
    ? { categoryId: body.categoryId }
    : { error: "categoryId: no such category (GET /categories lists them)" };
}
