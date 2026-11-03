// BOM writes, shared by the server actions (src/app/boms/actions.ts) and the
// REST API (src/app/api/v1/boms). Like part-mutations.ts, callers
// authenticate first and pass the acting user's id; everything here trusts
// it. Each function validates its input, writes, and revalidates the pages
// that show the result, so a BOM changed by a script looks like any other.

import { revalidatePath } from "next/cache";
import { and, asc, count, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { bomItems, boms, parts, stock } from "@/db/schema";
import {
  deductsOnBuild,
  parseQuantity,
  planConsumption,
  requirements,
  totalStock,
  type Allocation,
} from "@/lib/stock";
import { applyDelta, locationCodes, recordMovement } from "@/lib/movements";
import { parseBomCsv } from "@/lib/bom-csv";
import { matchPart } from "@/lib/bom-match";
import { isUniqueViolation } from "@/lib/db-errors";
import type { MutationResult } from "@/lib/part-mutations";

class BuildError extends Error {}

function revalidate(bomId?: string) {
  revalidatePath("/boms");
  if (bomId) revalidatePath(`/boms/${bomId}`);
}

async function touch(bomId: string) {
  await db.update(boms).set({ updatedAt: new Date() }).where(eq(boms.id, bomId));
}

const bomNotFound = { error: "BOM not found", code: "not_found" } as const;

export async function createBom(
  userId: string,
  input: { name: string; description: string },
): Promise<MutationResult & { id?: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  const [bom] = await db
    .insert(boms)
    .values({ name, description: input.description.trim(), createdBy: userId })
    .returning({ id: boms.id });
  revalidate();
  return { id: bom.id };
}

export async function updateBom(input: {
  id: string;
  name: string;
  description: string;
}): Promise<MutationResult> {
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  const updated = await db
    .update(boms)
    .set({ name, description: input.description.trim(), updatedAt: new Date() })
    .where(eq(boms.id, input.id))
    .returning({ id: boms.id });
  if (updated.length === 0) return bomNotFound;
  revalidate(input.id);
  return {};
}

// Deletes the BOM and its lines. Parts and their stock are untouched; past
// build movements keep their history with the BOM reference nulled.
export async function deleteBom(id: string): Promise<MutationResult> {
  const deleted = await db.delete(boms).where(eq(boms.id, id)).returning({ id: boms.id });
  if (deleted.length === 0) return bomNotFound;
  revalidate();
  return {};
}

export async function addBomItem(input: {
  bomId: string;
  partId: string;
  quantity: string | number;
  reference?: string;
  notes?: string;
}): Promise<MutationResult> {
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) return { error: "Quantity must be a positive whole number" };
  const [{ value: last }] = await db
    .select({ value: max(bomItems.position) })
    .from(bomItems)
    .where(eq(bomItems.bomId, input.bomId));
  try {
    await db.insert(bomItems).values({
      bomId: input.bomId,
      partId: input.partId,
      quantity,
      reference: (input.reference ?? "").trim(),
      notes: (input.notes ?? "").trim(),
      position: (last ?? -1) + 1,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "That part is already in this BOM — edit its line instead", code: "conflict" };
    }
    throw err;
  }
  await touch(input.bomId);
  revalidate(input.bomId);
  revalidatePath(`/parts/${input.partId}`);
  return {};
}

export async function updateBomItem(input: {
  id: string;
  quantity: string | number;
  reference: string;
  notes: string;
}): Promise<MutationResult> {
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) return { error: "Quantity must be a positive whole number" };
  const [item] = await db
    .update(bomItems)
    .set({ quantity, reference: input.reference.trim(), notes: input.notes.trim() })
    .where(eq(bomItems.id, input.id))
    .returning({ bomId: bomItems.bomId, partId: bomItems.partId });
  if (!item) return { error: "Line not found", code: "not_found" };
  await touch(item.bomId);
  revalidate(item.bomId);
  revalidatePath(`/parts/${item.partId}`);
  return {};
}

export async function removeBomItem(input: { id: string }): Promise<MutationResult> {
  const [item] = await db
    .delete(bomItems)
    .where(eq(bomItems.id, input.id))
    .returning({ bomId: bomItems.bomId, partId: bomItems.partId });
  if (!item) return { error: "Line not found", code: "not_found" };
  await touch(item.bomId);
  revalidate(item.bomId);
  revalidatePath(`/parts/${item.partId}`);
  return {};
}

/**
 * Sets the line for `partId` in a BOM, adding it at the end if the BOM
 * doesn't list the part yet — the API's idempotent counterpart to
 * addBomItem/updateBomItem, addressed by part since a BOM lists each part
 * once. Omitted reference/notes are cleared: the line becomes exactly this.
 */
export async function setBomLine(input: {
  bomId: string;
  partId: string;
  quantity: string | number;
  reference?: string;
  notes?: string;
}): Promise<MutationResult & { created?: boolean }> {
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) return { error: "Quantity must be a positive whole number" };
  const [bom, part] = await Promise.all([
    db.query.boms.findFirst({ where: eq(boms.id, input.bomId), columns: { id: true } }),
    db.query.parts.findFirst({ where: eq(parts.id, input.partId), columns: { id: true } }),
  ]);
  if (!bom) return bomNotFound;
  if (!part) return { error: "Part not found", code: "not_found" };

  const values = {
    quantity,
    reference: (input.reference ?? "").trim(),
    notes: (input.notes ?? "").trim(),
  };
  const created = await db.transaction(async (tx) => {
    const existing = await tx.query.bomItems.findFirst({
      where: and(eq(bomItems.bomId, input.bomId), eq(bomItems.partId, input.partId)),
      columns: { id: true },
    });
    const [{ value: last }] = await tx
      .select({ value: max(bomItems.position) })
      .from(bomItems)
      .where(eq(bomItems.bomId, input.bomId));
    // An upsert, so two clients adding the same line at once both succeed.
    await tx
      .insert(bomItems)
      .values({ bomId: input.bomId, partId: input.partId, ...values, position: (last ?? -1) + 1 })
      .onConflictDoUpdate({ target: [bomItems.bomId, bomItems.partId], set: values });
    return !existing;
  });
  await touch(input.bomId);
  revalidate(input.bomId);
  revalidatePath(`/parts/${input.partId}`);
  return { created };
}

/** Removes the line for `partId` from a BOM. */
export async function removeBomLine(input: { bomId: string; partId: string }): Promise<MutationResult> {
  const deleted = await db
    .delete(bomItems)
    .where(and(eq(bomItems.bomId, input.bomId), eq(bomItems.partId, input.partId)))
    .returning({ id: bomItems.id });
  if (deleted.length === 0) return { error: "The BOM doesn't list that part", code: "not_found" };
  await touch(input.bomId);
  revalidate(input.bomId);
  revalidatePath(`/parts/${input.partId}`);
  return {};
}

/** One draw of a build: `quantity` taken from one location (null = unsorted). */
export type BuildDraw = { partId: string; locationId: string | null; quantity: number };

/**
 * Builds `units` of a BOM: takes every line's parts out of stock (smallest
 * bins first, see planConsumption) and logs each draw as a "build" movement.
 * All or nothing — if any line is short, nothing is taken. Only counted parts
 * are taken (deductsOnBuild); an empty level/binary part still blocks.
 */
export async function buildBom(
  userId: string,
  input: { bomId: string; units: string | number; note?: string },
): Promise<MutationResult & { draws?: BuildDraw[] }> {
  const units = parseQuantity(input.units);
  if (units === null) return { error: "Units must be a positive whole number" };
  const bom = await db.query.boms.findFirst({ where: eq(boms.id, input.bomId), columns: { id: true } });
  if (!bom) return bomNotFound;

  const codes = await locationCodes();
  try {
    const draws = await db.transaction(async (tx) => {
      const items = await tx
        .select({
          partId: bomItems.partId,
          perUnit: bomItems.quantity,
          name: parts.name,
          tracking: parts.tracking,
        })
        .from(bomItems)
        .innerJoin(parts, eq(parts.id, bomItems.partId))
        .where(eq(bomItems.bomId, input.bomId))
        .orderBy(asc(bomItems.position));
      if (items.length === 0) throw new BuildError("The BOM has no lines");

      const plans: { partId: string; allocations: Allocation[] }[] = [];
      const short: string[] = [];
      for (const item of items) {
        // Lock the part's stock rows so a concurrent change can't make the
        // plan stale between reading and applying it.
        const slots = await tx
          .select({ locationId: stock.locationId, quantity: stock.quantity })
          .from(stock)
          .where(eq(stock.partId, item.partId))
          .for("update");
        if (!deductsOnBuild(item.tracking)) {
          const line = {
            ...item,
            inStock: totalStock(item.tracking, slots.map((s) => s.quantity)),
          };
          if (requirements([line], units)[0].shortfall > 0) short.push(item.name);
          continue;
        }
        const allocations = planConsumption(slots, item.perUnit * units);
        if (!allocations) short.push(item.name);
        else plans.push({ partId: item.partId, allocations });
      }
      if (short.length) {
        throw new BuildError(`Not enough stock of ${short.slice(0, 3).join(", ")}${short.length > 3 ? ` and ${short.length - 3} more` : ""}`);
      }

      const taken: BuildDraw[] = [];
      for (const plan of plans) {
        for (const a of plan.allocations) {
          if (!(await applyDelta(tx, plan.partId, a.locationId, -a.quantity))) {
            throw new BuildError("Stock changed during the build — try again");
          }
          await recordMovement(tx, {
            partId: plan.partId,
            kind: "build",
            quantity: -a.quantity,
            locationId: a.locationId,
            codes,
            bomId: input.bomId,
            note: input.note || `Built ${units} unit${units === 1 ? "" : "s"}`,
            userId,
          });
          taken.push({ partId: plan.partId, locationId: a.locationId, quantity: a.quantity });
        }
      }
      return taken;
    });
    revalidate(input.bomId);
    revalidatePath("/parts", "layout");
    revalidatePath("/locations", "layout");
    revalidatePath("/");
    return { draws };
  } catch (err) {
    if (err instanceof BuildError) return { error: err.message, code: "conflict" };
    throw err;
  }
}

export type ImportSummary = {
  added: number;
  updated: number;
  created: number;
  unmatched: { line: number; name: string; mpn: string }[];
  errors: { line: number; message: string }[];
};

/**
 * Imports BOM lines from CSV. Rows are matched to parts by MPN, else by
 * name (src/lib/bom-match.ts). With `createMissing` unmatched rows become new
 * parts; otherwise they're reported back. Lines already in the BOM take the
 * CSV's quantity and reference — re-importing an updated export converges.
 */
export async function importBomCsv(
  userId: string,
  input: { bomId: string; csv: string; createMissing: boolean },
): Promise<MutationResult & { summary?: ImportSummary }> {
  if (input.csv.length > 2_000_000) return { error: "The file is too large" };

  const bom = await db.query.boms.findFirst({ where: eq(boms.id, input.bomId), columns: { id: true } });
  if (!bom) return bomNotFound;

  const parsed = parseBomCsv(input.csv);
  if (parsed.rows.length === 0) {
    return { error: parsed.errors[0]?.message ?? "No rows to import" };
  }

  const summary: ImportSummary = { added: 0, updated: 0, created: 0, unmatched: [], errors: parsed.errors };
  await db.transaction(async (tx) => {
    const known = await tx.select({ id: parts.id, name: parts.name, mpn: parts.mpn }).from(parts);
    const existing = await tx
      .select({ id: bomItems.id, partId: bomItems.partId })
      .from(bomItems)
      .where(eq(bomItems.bomId, input.bomId));
    const lineByPart = new Map(existing.map((e) => [e.partId, e.id]));
    const [{ value: lineCount }] = await tx
      .select({ value: count() })
      .from(bomItems)
      .where(eq(bomItems.bomId, input.bomId));
    let position = lineCount;

    for (const row of parsed.rows) {
      let partId = matchPart(row, known);
      if (!partId) {
        if (!input.createMissing) {
          summary.unmatched.push({ line: row.line, name: row.name, mpn: row.mpn });
          continue;
        }
        const [created] = await tx
          .insert(parts)
          .values({
            name: row.name || row.mpn,
            mpn: row.mpn,
            manufacturer: row.manufacturer,
            createdBy: userId,
          })
          .returning({ id: parts.id });
        partId = created.id;
        known.push({ id: partId, name: row.name || row.mpn, mpn: row.mpn });
        summary.created += 1;
      }

      const lineId = lineByPart.get(partId);
      if (lineId) {
        await tx
          .update(bomItems)
          .set({ quantity: row.quantity, reference: row.reference, notes: row.notes })
          .where(eq(bomItems.id, lineId));
        summary.updated += 1;
      } else {
        const [line] = await tx
          .insert(bomItems)
          .values({
            bomId: input.bomId,
            partId,
            quantity: row.quantity,
            reference: row.reference,
            notes: row.notes,
            position: position++,
          })
          .returning({ id: bomItems.id });
        lineByPart.set(partId, line.id);
        summary.added += 1;
      }
    }
    await tx.update(boms).set({ updatedAt: new Date() }).where(eq(boms.id, input.bomId));
  });

  revalidate(input.bomId);
  revalidatePath("/parts", "layout");
  return { summary };
}
