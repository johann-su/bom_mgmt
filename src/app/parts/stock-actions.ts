"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { stock } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { parseQuantity } from "@/lib/stock";
import { applyDelta, locationCodes, recordMovement } from "@/lib/movements";

type Result = { error?: string };

// Thrown inside a transaction to roll it back with a user-facing message.
class StockError extends Error {}

function revalidate(partId: string) {
  revalidatePath(`/parts/${partId}`);
  revalidatePath("/parts");
  revalidatePath("/locations", "layout");
  revalidatePath("/boms", "layout");
  revalidatePath("/");
}

/**
 * Changes the stock of one part in one location:
 *  - add / remove: by `quantity`
 *  - set: to `quantity` after a stock-take (recorded as an "adjust" by the
 *    difference)
 * Every change lands in stock_movements.
 */
export async function changeStock(input: {
  partId: string;
  locationId: string;
  mode: "add" | "remove" | "set";
  quantity: string | number;
  note?: string;
}): Promise<Result> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const quantity = parseQuantity(input.quantity, { allowZero: input.mode === "set" });
  if (quantity === null) return { error: "Enter a whole number" };

  const codes = await locationCodes();
  if (!codes.has(input.locationId)) return { error: "Location not found" };

  try {
    await db.transaction(async (tx) => {
      let delta = input.mode === "remove" ? -quantity : quantity;
      if (input.mode === "set") {
        const current = await tx.query.stock.findFirst({
          where: and(eq(stock.partId, input.partId), eq(stock.locationId, input.locationId)),
          columns: { quantity: true },
        });
        delta = quantity - (current?.quantity ?? 0);
      }
      if (!(await applyDelta(tx, input.partId, input.locationId, delta))) {
        throw new StockError("Not enough stock in that location");
      }
      // A stock-take that matches the count changes nothing worth logging,
      // but the row above still records the location as the part's home.
      if (delta === 0) return;
      await recordMovement(tx, {
        partId: input.partId,
        kind: input.mode === "set" ? "adjust" : input.mode,
        quantity: delta,
        locationId: input.locationId,
        codes,
        note: input.note,
        userId: session.user.id,
      });
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  revalidate(input.partId);
  return {};
}

export async function moveStock(input: {
  partId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: string | number;
  note?: string;
}): Promise<Result> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) return { error: "Enter a whole number" };
  if (input.fromLocationId === input.toLocationId) return { error: "Pick a different location" };

  const codes = await locationCodes();
  if (!codes.has(input.fromLocationId) || !codes.has(input.toLocationId)) {
    return { error: "Location not found" };
  }

  try {
    await db.transaction(async (tx) => {
      if (!(await applyDelta(tx, input.partId, input.fromLocationId, -quantity))) {
        throw new StockError("Not enough stock to move");
      }
      await applyDelta(tx, input.partId, input.toLocationId, quantity);
      await recordMovement(tx, {
        partId: input.partId,
        kind: "move",
        quantity,
        locationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        codes,
        note: input.note,
        userId: session.user.id,
      });
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  revalidate(input.partId);
  return {};
}

// Forgets an empty location as a home of the part. Only rows at zero — stock
// has to be removed or moved first, so it's always accounted for.
export async function forgetStockLocation(input: {
  partId: string;
  locationId: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const deleted = await db
    .delete(stock)
    .where(
      and(
        eq(stock.partId, input.partId),
        eq(stock.locationId, input.locationId),
        eq(stock.quantity, 0),
      ),
    )
    .returning({ id: stock.id });
  if (deleted.length === 0) return { error: "Only empty locations can be removed" };
  revalidate(input.partId);
  return {};
}
