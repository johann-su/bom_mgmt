// Part and stock writes, shared by the server actions (src/app/parts/*.ts) and
// the MCP tools (src/lib/mcp/tools.ts). Callers authenticate first and pass
// the acting user's id; everything here trusts it. Each function validates its
// input, writes inside a transaction, and revalidates the pages that show the
// result — so a change made by an LLM client shows up in the app like any
// other.

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { bomItems, files, parts, stock } from "@/db/schema";
import { parsePartInput } from "@/lib/part-input";
import { parseQuantity } from "@/lib/stock";
import { applyDelta, locationCodes, recordMovement } from "@/lib/movements";
import { blobStore } from "@/lib/storage";
import { logger } from "@/lib/logger";

export type MutationResult = { error?: string };

// Thrown inside a transaction to roll it back with a user-facing message.
class StockError extends Error {}

/** Every page that shows parts or stock levels. */
export function revalidateInventory(partId?: string) {
  revalidatePath("/parts");
  if (partId) revalidatePath(`/parts/${partId}`);
  revalidatePath("/locations", "layout");
  revalidatePath("/boms", "layout");
  revalidatePath("/");
}

/**
 * Creates a part, optionally with its first stock (`initialLocationId` +
 * `initialQuantity`), which is logged as an "add" movement like any other.
 */
export async function createPart(
  userId: string,
  raw: Record<string, unknown> & { initialLocationId?: string | null; initialQuantity?: string },
): Promise<MutationResult & { id?: string }> {
  const input = parsePartInput(raw);
  if ("error" in input) return input;

  const initialQuantity =
    raw.initialLocationId && raw.initialQuantity
      ? parseQuantity(raw.initialQuantity, { allowZero: true })
      : null;
  if (raw.initialLocationId && raw.initialQuantity && initialQuantity === null) {
    return { error: "Initial quantity must be a whole number" };
  }
  const codes = raw.initialLocationId ? await locationCodes() : new Map<string, string>();
  if (raw.initialLocationId && !codes.has(raw.initialLocationId)) {
    return { error: "Location not found" };
  }

  const id = await db.transaction(async (tx) => {
    const [part] = await tx
      .insert(parts)
      .values({ ...input, createdBy: userId })
      .returning({ id: parts.id });
    if (raw.initialLocationId) {
      const quantity = initialQuantity ?? 0;
      await applyDelta(tx, part.id, raw.initialLocationId, quantity);
      if (quantity > 0) {
        await recordMovement(tx, {
          partId: part.id,
          kind: "add",
          quantity,
          locationId: raw.initialLocationId,
          codes,
          note: "Initial stock",
          userId,
        });
      }
    }
    return part.id;
  });

  revalidateInventory();
  return { id };
}

/** Replaces every field of a part with the (complete) form values in `raw`. */
export async function updatePart(id: string, raw: Record<string, unknown>): Promise<MutationResult> {
  const input = parsePartInput(raw);
  if ("error" in input) return input;
  const updated = await db
    .update(parts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(parts.id, id))
    .returning({ id: parts.id });
  if (updated.length === 0) return { error: "Part not found" };
  revalidateInventory(id);
  return {};
}

// Deletes a part with its stock rows, history and files. Refused while a BOM
// still lists it — removing it there is a deliberate decision.
export async function deletePart(id: string): Promise<MutationResult> {
  const [{ value: inBoms }] = await db
    .select({ value: count() })
    .from(bomItems)
    .where(eq(bomItems.partId, id));
  if (inBoms > 0) return { error: `It is used in ${inBoms} BOM(s) — remove it there first` };

  const stored = await db
    .select({ key: files.storageKey })
    .from(files)
    .where(eq(files.partId, id));
  const deleted = await db.delete(parts).where(eq(parts.id, id)).returning({ id: parts.id });
  if (deleted.length === 0) return { error: "Part not found" };

  // Rows are gone (cascade); storage cleanup is best-effort, an orphaned
  // object is harmless.
  try {
    await blobStore().delete(stored.map((f) => f.key));
  } catch (err) {
    logger.warn({ err }, `Failed to delete stored files of part ${id}`);
  }
  revalidateInventory();
  return {};
}

/**
 * Changes the stock of one part in one location:
 *  - add / remove: by `quantity`
 *  - set: to `quantity` after a stock-take (recorded as an "adjust" by the
 *    difference)
 * Every change lands in stock_movements.
 */
export async function changeStock(
  userId: string,
  input: {
    partId: string;
    locationId: string;
    mode: "add" | "remove" | "set";
    quantity: string | number;
    note?: string;
  },
): Promise<MutationResult> {
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
        userId,
      });
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  revalidateInventory(input.partId);
  return {};
}

export async function moveStock(
  userId: string,
  input: {
    partId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: string | number;
    note?: string;
  },
): Promise<MutationResult> {
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
        userId,
      });
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  revalidateInventory(input.partId);
  return {};
}
