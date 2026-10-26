import { and, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { parts, stock } from "@/db/schema";

// Per location: how many distinct parts it holds — any with stock there, and
// untracked parts, which hold none but live there.
export async function partCountsByLocation(): Promise<Map<string, number>> {
  const rows = await db
    .select({ locationId: stock.locationId, parts: sql<number>`count(*)::int` })
    .from(stock)
    .innerJoin(parts, eq(parts.id, stock.partId))
    .where(and(or(gt(stock.quantity, 0), eq(parts.tracking, "none")), isNotNull(stock.locationId)))
    .groupBy(stock.locationId);
  return new Map(rows.map((r) => [r.locationId!, r.parts]));
}
