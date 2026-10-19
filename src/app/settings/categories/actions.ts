"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db-errors";

type Result = { error?: string };

function revalidate() {
  revalidatePath("/settings/categories");
  revalidatePath("/parts", "layout");
}

export async function saveCategory(input: { id?: string; name: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  try {
    if (input.id) {
      await db.update(categories).set({ name }).where(eq(categories.id, input.id));
    } else {
      await db.insert(categories).values({ name });
    }
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `Category "${name}" already exists` };
    throw err;
  }
  revalidate();
  return {};
}

// Parts in the category become uncategorized (FK on delete set null).
export async function deleteCategory(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  await db.delete(categories).where(eq(categories.id, input.id));
  revalidate();
  return {};
}
