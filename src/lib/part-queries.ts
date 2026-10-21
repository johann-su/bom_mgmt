import { and, asc, eq, gt, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, parts, stock } from "@/db/schema";

// Total stock of a part across all locations, as a correlated subquery.
export const totalStock = sql<number>`coalesce((select sum(${stock.quantity}) from ${stock} where ${stock.partId} = ${parts.id}), 0)::int`;

export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Matches parts by name, MPN, manufacturer, description or attribute values.
export function partSearchFilter(q: string): SQL | undefined {
  const term = `%${escapeLike(q.trim())}%`;
  if (!q.trim()) return undefined;
  return or(
    ilike(parts.name, term),
    ilike(parts.mpn, term),
    ilike(parts.manufacturer, term),
    ilike(parts.description, term),
    sql`${parts.attributes}::text ilike ${term}`,
  );
}

export async function listParts(filters: {
  q?: string;
  categoryId?: string | null;
  lowStock?: boolean;
  limit?: number;
}) {
  const conditions = [
    filters.q ? partSearchFilter(filters.q) : undefined,
    filters.categoryId ? eq(parts.categoryId, filters.categoryId) : undefined,
    filters.lowStock ? and(isNotNull(parts.minStock), sql`${totalStock} < ${parts.minStock}`) : undefined,
  ].filter(Boolean);

  return db
    .select({
      id: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      unit: parts.unit,
      minStock: parts.minStock,
      orderUrl: parts.orderUrl,
      category: categories.name,
      total: totalStock,
    })
    .from(parts)
    .leftJoin(categories, eq(categories.id, parts.categoryId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(parts.name))
    .limit(filters.limit ?? 500);
}

export type PartListRow = Awaited<ReturnType<typeof listParts>>[number];

// Location ids holding stock (> 0) of each part, for the "where is it" column.
export async function stockLocationsByPart(partIds: string[]): Promise<Map<string, string[]>> {
  if (partIds.length === 0) return new Map();
  const rows = await db
    .select({ partId: stock.partId, locationId: stock.locationId })
    .from(stock)
    .where(and(inArray(stock.partId, partIds), gt(stock.quantity, 0)));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.partId, [...(out.get(r.partId) ?? []), r.locationId]);
  return out;
}
