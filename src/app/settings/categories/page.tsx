import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, parts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { CategoriesEditor } from "./categories-editor";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  await requireSession();
  const rows = await db
    .select({ id: categories.id, name: categories.name, usage: count(parts.id) })
    .from(categories)
    .leftJoin(parts, eq(parts.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Categories</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Group parts for filtering — fasteners, resistors, connectors, filament….
      </p>
      <CategoriesEditor categories={rows} />
    </section>
  );
}
