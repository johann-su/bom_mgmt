import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { stock, stockMovements } from "@/db/schema";
import type { MovementKind } from "@/lib/stock";
import { loadLocations } from "@/lib/locations";
import { ancestry, locationCode } from "@/lib/location-tree";
import { getCodeSeparator } from "@/lib/settings";

// Location codes ("A/1/IV") by id, frozen into movement rows so history stays
// readable after a location is renamed or deleted.
export async function locationCodes(): Promise<Map<string, string>> {
  const [all, separator] = await Promise.all([loadLocations(), getCodeSeparator()]);
  const byId = new Map(all.map((l) => [l.id, l]));
  return new Map(all.map((l) => [l.id, locationCode(ancestry(byId, l.id), separator)]));
}

/** Matches a part's stock row at `locationId`; null is the unsorted pile. */
export function stockAt(partId: string, locationId: string | null) {
  return and(
    eq(stock.partId, partId),
    locationId ? eq(stock.locationId, locationId) : isNull(stock.locationId),
  );
}

/**
 * Applies a signed delta to one (part, location) stock row inside `tx`,
 * creating the row on first use. A null location is the unsorted pile. Returns false — and changes nothing — when
 * the result would go negative; the CHECK constraint backs this up.
 */
export async function applyDelta(
  tx: Tx,
  partId: string,
  locationId: string | null,
  delta: number,
): Promise<boolean> {
  await tx
    .insert(stock)
    .values({ partId, locationId, quantity: 0 })
    .onConflictDoNothing({ target: [stock.partId, stock.locationId] });
  const updated = await tx
    .update(stock)
    .set({ quantity: sql`${stock.quantity} + ${delta}`, updatedAt: new Date() })
    .where(
      and(stockAt(partId, locationId), sql`${stock.quantity} + ${delta} >= 0`),
    )
    .returning({ id: stock.id });
  return updated.length === 1;
}

export async function recordMovement(
  tx: Tx,
  movement: {
    partId: string;
    kind: MovementKind;
    quantity: number;
    locationId: string | null;
    toLocationId?: string | null;
    codes: Map<string, string>;
    bomId?: string | null;
    note?: string;
    userId: string;
  },
) {
  await tx.insert(stockMovements).values({
    partId: movement.partId,
    kind: movement.kind,
    quantity: movement.quantity,
    locationId: movement.locationId,
    toLocationId: movement.toLocationId ?? null,
    locationPath: movement.locationId ? (movement.codes.get(movement.locationId) ?? "") : "",
    toLocationPath: movement.toLocationId ? (movement.codes.get(movement.toLocationId) ?? "") : "",
    bomId: movement.bomId ?? null,
    note: (movement.note ?? "").trim().slice(0, 500),
    userId: movement.userId,
  });
}
