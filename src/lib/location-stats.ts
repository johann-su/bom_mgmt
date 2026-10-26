import { and, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { stock } from "@/db/schema";

// Per location: how many distinct parts it holds (quantity > 0).
export async function partCountsByLocation(): Promise<Map<string, number>> {
  const rows = await db
    .select({ locationId: stock.locationId, parts: sql<number>`count(*)::int` })
    .from(stock)
    .where(and(gt(stock.quantity, 0), isNotNull(stock.locationId)))
    .groupBy(stock.locationId);
  return new Map(rows.map((r) => [r.locationId!, r.parts]));
}
