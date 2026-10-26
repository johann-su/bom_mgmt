"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asc, count, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { bomItems, boms, parts, stock } from "@/db/schema";
import { getSession } from "@/lib/auth";
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

type Result = { error?: string };

class BuildError extends Error {}

function revalidate(bomId?: string) {
  revalidatePath("/boms");
  if (bomId) revalidatePath(`/boms/${bomId}`);
}

async function touch(bomId: string) {
  await db.update(boms).set({ updatedAt: new Date() }).where(eq(boms.id, bomId));
}

export async function createBom(input: { name: string; description: string }): Promise<Result> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  const [bom] = await db
    .insert(boms)
    .values({ name, description: input.description.trim(), createdBy: session.user.id })
    .returning({ id: boms.id });
  revalidate();
  redirect(`/boms/${bom.id}`);
}

export async function updateBom(input: {
  id: string;
  name: string;
  description: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const name = input.name.trim();
  if (!name) return { error: "Name is required" };
  await db
    .update(boms)
    .set({ name, description: input.description.trim(), updatedAt: new Date() })
    .where(eq(boms.id, input.id));
  revalidate(input.id);
  return {};
}

// Deletes the BOM and its lines. Parts and their stock are untouched; past
// build movements keep their history with the BOM reference nulled.
export async function deleteBom(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  await db.delete(boms).where(eq(boms.id, input.id));
  revalidate();
  redirect("/boms");
}

export async function addBomItem(input: {
  bomId: string;
  partId: string;
  quantity: string | number;
  reference?: string;
  notes?: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
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
    if (isUniqueViolation(err)) return { error: "That part is already in this BOM — edit its line instead" };
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
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const quantity = parseQuantity(input.quantity);
  if (quantity === null) return { error: "Quantity must be a positive whole number" };
  const [item] = await db
    .update(bomItems)
    .set({ quantity, reference: input.reference.trim(), notes: input.notes.trim() })
    .where(eq(bomItems.id, input.id))
    .returning({ bomId: bomItems.bomId, partId: bomItems.partId });
  if (!item) return { error: "Line not found" };
  await touch(item.bomId);
  revalidate(item.bomId);
  revalidatePath(`/parts/${item.partId}`);
  return {};
}

export async function removeBomItem(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const [item] = await db
    .delete(bomItems)
    .where(eq(bomItems.id, input.id))
    .returning({ bomId: bomItems.bomId, partId: bomItems.partId });
  if (!item) return { error: "Line not found" };
  await touch(item.bomId);
  revalidate(item.bomId);
  revalidatePath(`/parts/${item.partId}`);
  return {};
}

/**
 * Builds `units` of a BOM: takes every line's parts out of stock (smallest
 * bins first, see planConsumption) and logs each draw as a "build" movement.
 * All or nothing — if any line is short, nothing is taken. Only counted parts
 * are taken (deductsOnBuild); an empty level/binary part still blocks.
 */
export async function buildBom(input: {
  bomId: string;
  units: string | number;
  note?: string;
}): Promise<Result & { taken?: number }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const units = parseQuantity(input.units);
  if (units === null) return { error: "Units must be a positive whole number" };

  const codes = await locationCodes();
  try {
    const taken = await db.transaction(async (tx) => {
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

      let draws = 0;
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
            userId: session.user.id,
          });
          draws += 1;
        }
      }
      return draws;
    });
    revalidate(input.bomId);
    revalidatePath("/parts", "layout");
    revalidatePath("/locations", "layout");
    revalidatePath("/");
    return { taken };
  } catch (err) {
    if (err instanceof BuildError) return { error: err.message };
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
export async function importBomCsv(input: {
  bomId: string;
  csv: string;
  createMissing: boolean;
}): Promise<Result & { summary?: ImportSummary }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  if (input.csv.length > 2_000_000) return { error: "The file is too large" };

  const bom = await db.query.boms.findFirst({ where: eq(boms.id, input.bomId), columns: { id: true } });
  if (!bom) return { error: "BOM not found" };

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
            createdBy: session.user.id,
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
