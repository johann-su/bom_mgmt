import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bomItems, boms, parts } from "@/db/schema";
import { totalStock } from "@/lib/part-queries";
import { buildableUnits } from "@/lib/stock";

export async function loadBomLines(bomId: string) {
  return db
    .select({
      id: bomItems.id,
      partId: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      unit: parts.unit,
      perUnit: bomItems.quantity,
      reference: bomItems.reference,
      notes: bomItems.notes,
      inStock: totalStock,
    })
    .from(bomItems)
    .innerJoin(parts, eq(parts.id, bomItems.partId))
    .where(eq(bomItems.bomId, bomId))
    .orderBy(asc(bomItems.position), asc(parts.name));
}

export type BomLineRow = Awaited<ReturnType<typeof loadBomLines>>[number];

// Every BOM with its line count and how many units current stock can build.
export async function listBoms() {
  const [all, lines] = await Promise.all([
    db.select().from(boms).orderBy(desc(boms.updatedAt)),
    db
      .select({ bomId: bomItems.bomId, partId: bomItems.partId, perUnit: bomItems.quantity, inStock: totalStock })
      .from(bomItems)
      .innerJoin(parts, eq(parts.id, bomItems.partId)),
  ]);
  return all.map((bom) => {
    const own = lines.filter((l) => l.bomId === bom.id);
    return { ...bom, lineCount: own.length, buildable: buildableUnits(own) };
  });
}
