import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { boms, parts, stockMovements, user } from "@/db/schema";

// Recent stock movements, newest first — for one part, one BOM's builds, or
// everything (dashboard, activity) when neither is given.
export async function recentMovements({
  partId,
  bomId,
  limit = 50,
}: {
  partId?: string;
  bomId?: string;
  limit?: number;
}) {
  return db
    .select({
      id: stockMovements.id,
      kind: stockMovements.kind,
      quantity: stockMovements.quantity,
      locationId: stockMovements.locationId,
      toLocationId: stockMovements.toLocationId,
      locationPath: stockMovements.locationPath,
      toLocationPath: stockMovements.toLocationPath,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      partId: stockMovements.partId,
      partName: parts.name,
      unit: parts.unit,
      tracking: parts.tracking,
      userName: user.name,
      bomId: stockMovements.bomId,
      bomName: boms.name,
    })
    .from(stockMovements)
    .innerJoin(parts, eq(parts.id, stockMovements.partId))
    .leftJoin(user, eq(user.id, stockMovements.userId))
    .leftJoin(boms, eq(boms.id, stockMovements.bomId))
    .where(
      and(
        partId ? eq(stockMovements.partId, partId) : undefined,
        bomId ? eq(stockMovements.bomId, bomId) : undefined,
      ),
    )
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
}

export type MovementRow = Awaited<ReturnType<typeof recentMovements>>[number];
