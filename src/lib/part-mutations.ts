// Part and stock writes, shared by the server actions (src/app/parts/*.ts) and
// the MCP tools (src/lib/mcp/tools.ts). Callers authenticate first and pass
// the acting user's id; everything here trusts it. Each function validates its
// input, writes inside a transaction, and revalidates the pages that show the
// result — so a change made by an LLM client shows up in the app like any
// other.

import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { bomItems, files, parts, stock } from "@/db/schema";
import { parsePartInput } from "@/lib/part-input";
import {
  convertStock,
  parseLevel,
  parseQuantity,
  STOCK_LEVELS,
  TRACKING_INFO,
  type Tracking,
} from "@/lib/stock";
import { applyDelta, locationCodes, recordMovement, stockAt } from "@/lib/movements";
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
 * A quantity without a location lands in the part's unsorted pile. For a
 * level/binary part `initialQuantity` is the level (empty when omitted); an
 * untracked part only takes the location.
 */
export async function createPart(
  userId: string,
  raw: Record<string, unknown> & { initialLocationId?: string | null; initialQuantity?: string },
): Promise<MutationResult & { id?: string }> {
  const input = parsePartInput(raw);
  if ("error" in input) return input;

  const initialLocationId = raw.initialLocationId || null;
  const counted = input.tracking === "exact";
  const initialQuantity =
    input.tracking === "none" || !raw.initialQuantity
      ? null
      : counted
        ? parseQuantity(raw.initialQuantity, { allowZero: true })
        : parseLevel(input.tracking, raw.initialQuantity);
  if (raw.initialQuantity && input.tracking !== "none" && initialQuantity === null) {
    return { error: counted ? "Initial quantity must be a whole number" : "Pick a stock level" };
  }
  const codes = initialLocationId ? await locationCodes() : new Map<string, string>();
  if (initialLocationId && !codes.has(initialLocationId)) {
    return { error: "Location not found" };
  }

  const id = await db.transaction(async (tx) => {
    const [part] = await tx
      .insert(parts)
      .values({ ...input, createdBy: userId })
      .returning({ id: parts.id });
    // A location alone records the part's home; unsorted needs a quantity.
    if (initialLocationId || initialQuantity) {
      const quantity = initialQuantity ?? 0;
      await applyDelta(tx, part.id, initialLocationId, quantity);
      if (quantity > 0) {
        await recordMovement(tx, {
          partId: part.id,
          kind: counted ? "add" : "level",
          quantity,
          locationId: initialLocationId,
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

/**
 * Replaces every field of a part with the (complete) form values in `raw`.
 * Changing the tracking mode converts the stored stock (see convertStock):
 * counts become levels, and levels become counts of 0 to be counted.
 */
export async function updatePart(id: string, raw: Record<string, unknown>): Promise<MutationResult> {
  const input = parsePartInput(raw);
  if ("error" in input) return input;
  const found = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ tracking: parts.tracking, minStock: parts.minStock })
      .from(parts)
      .where(eq(parts.id, id))
      .for("update");
    if (!before) return false;
    await tx
      .update(parts)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(parts.id, id));
    if (before.tracking !== input.tracking) {
      const rows = await tx
        .select({ id: stock.id, quantity: stock.quantity })
        .from(stock)
        .where(eq(stock.partId, id));
      for (const row of rows) {
        const quantity = convertStock(before.tracking, input.tracking, row.quantity, before.minStock);
        if (quantity !== row.quantity) {
          await tx.update(stock).set({ quantity, updatedAt: new Date() }).where(eq(stock.id, row.id));
        }
      }
    }
    return true;
  });
  if (!found) return { error: "Part not found" };
  revalidateInventory(id);
  return {};
}

async function partTracking(partId: string): Promise<Tracking | null> {
  const part = await db.query.parts.findFirst({
    where: eq(parts.id, partId),
    columns: { tracking: true },
  });
  return part?.tracking ?? null;
}

// Which changeStock modes fit a tracking mode.
const STOCK_MODES: Record<Tracking, StockChangeMode[]> = {
  exact: ["add", "remove", "set"],
  level: ["level"],
  binary: ["level"],
  none: ["place"],
};

export type StockChangeMode = "add" | "remove" | "set" | "level" | "place";

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
 * Changes the stock of one part in one location. Exact parts:
 *  - add / remove: by `quantity`
 *  - set: to `quantity` after a stock-take (recorded as an "adjust" by the
 *    difference)
 * Level/binary parts:
 *  - level: to the level `quantity` (a STOCK_LEVELS value or its label)
 * Untracked parts:
 *  - place: records the location as one it lives in (`quantity` ignored)
 * A null location is the part's unsorted pile. Every change lands in
 * stock_movements.
 */
export async function changeStock(
  userId: string,
  input: {
    partId: string;
    locationId: string | null;
    mode: StockChangeMode;
    quantity?: string | number;
    note?: string;
  },
): Promise<MutationResult> {
  const tracking = await partTracking(input.partId);
  if (!tracking) return { error: "Part not found" };
  if (!STOCK_MODES[tracking].includes(input.mode)) {
    const label = TRACKING_INFO[tracking].label.toLowerCase();
    return {
      error:
        tracking === "exact"
          ? "This part is counted — add, remove or set a quantity"
          : tracking === "none"
            ? "This part's stock isn't tracked — only where it lives"
            : `This part is tracked by ${label} — set its level instead`,
    };
  }
  input = { ...input, locationId: input.locationId || null };
  if (input.mode === "place" && !input.locationId) return { error: "Pick a location" };

  const codes = await locationCodes();
  if (input.locationId && !codes.has(input.locationId)) return { error: "Location not found" };

  if (input.mode === "level" || input.mode === "place") {
    const level =
      input.mode === "level" ? parseLevel(tracking, input.quantity) : STOCK_LEVELS.empty;
    if (level === null) return { error: "Pick a stock level" };
    await db.transaction(async (tx) => {
      const current = await tx.query.stock.findFirst({
        where: stockAt(input.partId, input.locationId),
        columns: { quantity: true },
      });
      // Creates the row (the part's home) when it's new.
      await applyDelta(tx, input.partId, input.locationId, level - (current?.quantity ?? 0));
      if (input.mode === "place" || current?.quantity === level) return;
      await recordMovement(tx, {
        partId: input.partId,
        kind: "level",
        quantity: level,
        locationId: input.locationId,
        codes,
        note: input.note,
        userId,
      });
    });
    revalidateInventory(input.partId);
    return {};
  }

  const quantity = parseQuantity(input.quantity, { allowZero: input.mode === "set" });
  if (quantity === null) return { error: "Enter a whole number" };

  try {
    await db.transaction(async (tx) => {
      let delta = input.mode === "remove" ? -quantity : quantity;
      if (input.mode === "set") {
        const current = await tx.query.stock.findFirst({
          where: stockAt(input.partId, input.locationId),
          columns: { quantity: true },
        });
        delta = quantity - (current?.quantity ?? 0);
      }
      if (!(await applyDelta(tx, input.partId, input.locationId, delta))) {
        throw new StockError(
          input.locationId ? "Not enough stock in that location" : "Not enough unsorted stock",
        );
      }
      // A stock-take that matches the count changes nothing worth logging,
      // but the row above still records the location as the part's home.
      if (delta === 0) return;
      await recordMovement(tx, {
        partId: input.partId,
        kind: input.mode === "set" ? "adjust" : (input.mode as "add" | "remove"),
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

/**
 * Moves stock between two places; either may be null (the unsorted pile), so
 * putting unsorted stock away is a move from null into a location. Level and
 * binary parts can't be split, so everything at `from` moves (`quantity` is
 * ignored) and `to` keeps the better level; an untracked part simply moves
 * house. Those moves are logged with quantity 0 — "all of it".
 */
export async function moveStock(
  userId: string,
  input: {
    partId: string;
    fromLocationId: string | null;
    toLocationId: string | null;
    quantity?: string | number;
    note?: string;
  },
): Promise<MutationResult> {
  const tracking = await partTracking(input.partId);
  if (!tracking) return { error: "Part not found" };
  const counted = tracking === "exact";
  const quantity = counted ? parseQuantity(input.quantity) : 0;
  if (quantity === null) return { error: "Enter a whole number" };
  input = { ...input, fromLocationId: input.fromLocationId || null, toLocationId: input.toLocationId || null };
  if (input.fromLocationId === input.toLocationId) return { error: "Pick a different location" };
  if (tracking === "none" && (!input.fromLocationId || !input.toLocationId)) {
    return { error: "Untracked parts have no unsorted pile" };
  }

  const codes = await locationCodes();
  if (
    (input.fromLocationId && !codes.has(input.fromLocationId)) ||
    (input.toLocationId && !codes.has(input.toLocationId))
  ) {
    return { error: "Location not found" };
  }

  try {
    await db.transaction(async (tx) => {
      if (counted) {
        if (!(await applyDelta(tx, input.partId, input.fromLocationId, -quantity))) {
          throw new StockError("Not enough stock to move");
        }
        await applyDelta(tx, input.partId, input.toLocationId, quantity);
      } else {
        const [from] = await tx
          .select({ id: stock.id, quantity: stock.quantity })
          .from(stock)
          .where(stockAt(input.partId, input.fromLocationId))
          .for("update");
        if (!from || (tracking !== "none" && from.quantity === 0)) {
          throw new StockError("Nothing to move");
        }
        const to = await tx.query.stock.findFirst({
          where: stockAt(input.partId, input.toLocationId),
          columns: { quantity: true },
        });
        const current = to?.quantity ?? 0;
        await applyDelta(tx, input.partId, input.toLocationId, Math.max(0, from.quantity - current));
        // A level/binary bin stays the part's home at empty, like an emptied
        // exact bin; an untracked part just doesn't live there any more.
        if (tracking === "none") await tx.delete(stock).where(eq(stock.id, from.id));
        else await applyDelta(tx, input.partId, input.fromLocationId, -from.quantity);
      }
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
