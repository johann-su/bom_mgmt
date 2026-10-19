"use server";

import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { bomItems, files, parts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { parsePartInput } from "@/lib/part-input";
import { parseQuantity } from "@/lib/stock";
import { applyDelta, locationCodes, recordMovement } from "@/lib/movements";
import { blobStore } from "@/lib/storage";
import { logger } from "@/lib/logger";

type Result = { error?: string };

function revalidate(partId?: string) {
  revalidatePath("/parts");
  if (partId) revalidatePath(`/parts/${partId}`);
  revalidatePath("/locations", "layout");
  revalidatePath("/");
}

/**
 * Creates a part, optionally with its first stock (`initialLocationId` +
 * `initialQuantity`), which is logged as an "add" movement like any other.
 */
export async function createPart(
  raw: Record<string, unknown> & { initialLocationId?: string | null; initialQuantity?: string },
): Promise<Result & { id?: string }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
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
      .values({ ...input, createdBy: session.user.id })
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
          userId: session.user.id,
        });
      }
    }
    return part.id;
  });

  revalidate();
  return { id };
}

export async function updatePart(raw: Record<string, unknown> & { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const input = parsePartInput(raw);
  if ("error" in input) return input;
  const updated = await db
    .update(parts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(parts.id, raw.id))
    .returning({ id: parts.id });
  if (updated.length === 0) return { error: "Part not found" };
  revalidate(raw.id);
  revalidatePath("/boms", "layout");
  return {};
}

// Deletes a part with its stock rows, history and files. Refused while a BOM
// still lists it — removing it there is a deliberate decision.
export async function deletePart(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };

  const [{ value: inBoms }] = await db
    .select({ value: count() })
    .from(bomItems)
    .where(eq(bomItems.partId, input.id));
  if (inBoms > 0) return { error: `It is used in ${inBoms} BOM(s) — remove it there first` };

  const stored = await db
    .select({ key: files.storageKey })
    .from(files)
    .where(eq(files.partId, input.id));
  await db.delete(parts).where(eq(parts.id, input.id));

  // Rows are gone (cascade); storage cleanup is best-effort, an orphaned
  // object is harmless.
  try {
    await blobStore().delete(stored.map((f) => f.key));
  } catch (err) {
    logger.warn({ err }, `Failed to delete stored files of part ${input.id}`);
  }
  revalidate();
  return {};
}

export async function deletePartFile(input: { fileId: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const [file] = await db
    .delete(files)
    .where(eq(files.id, input.fileId))
    .returning({ partId: files.partId, key: files.storageKey });
  if (!file) return { error: "File not found" };
  try {
    await blobStore().delete([file.key]);
  } catch (err) {
    logger.warn({ err }, `Failed to delete stored file ${input.fileId}`);
  }
  revalidate(file.partId);
  return {};
}

// Makes an image the part's thumbnail by moving it to the front.
export async function makeCoverImage(input: { fileId: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const file = await db.query.files.findFirst({
    where: eq(files.id, input.fileId),
    columns: { partId: true },
  });
  if (!file) return { error: "File not found" };
  await db.transaction(async (tx) => {
    const all = await tx
      .select({ id: files.id })
      .from(files)
      .where(eq(files.partId, file.partId))
      .orderBy(files.position, files.createdAt);
    const ordered = [input.fileId, ...all.map((f) => f.id).filter((id) => id !== input.fileId)];
    for (const [position, id] of ordered.entries()) {
      await tx.update(files).set({ position }).where(eq(files.id, id));
    }
  });
  revalidate(file.partId);
  return {};
}
