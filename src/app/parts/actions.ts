"use server";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { files, parts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import * as mutations from "@/lib/part-mutations";
import { parseOrderUrl } from "@/lib/part-input";
import { fetchProductInfo } from "@/lib/product-fetch";
import type { ProductInfo } from "@/lib/product-page";
import { blobStore } from "@/lib/storage";
import { logger } from "@/lib/logger";

type Result = { error?: string };

// Part writes live in src/lib/part-mutations.ts (shared with the MCP tools);
// these actions add the session check.
const revalidate = mutations.revalidateInventory;

export async function createPart(
  raw: Record<string, unknown> & { initialLocationId?: string | null; initialQuantity?: string },
): Promise<Result & { id?: string }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  return mutations.createPart(session.user.id, raw);
}

/**
 * Reads the product data (schema.org JSON-LD / OpenGraph) from an order link
 * so the part form can prefill itself. Nothing is stored.
 */
export async function lookupOrderUrl(input: {
  url: string;
}): Promise<Result & { product?: ProductInfo }> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const url = parseOrderUrl(input.url);
  if (!url) return { error: "Enter an http(s) order link first" };
  const result = await fetchProductInfo(url);
  if ("error" in result) {
    logger.info({ url, error: result.error }, "Order link lookup failed");
    return result;
  }
  return result;
}

/**
 * Finds the part a scanned bag label is for: by MPN, else by the
 * distributor's part number appearing as a path/query segment of a part's
 * order link (an LCSC "C2040" in …/product-detail/C2040.html).
 */
export async function findPartByLabel(input: {
  mpn: string;
  supplierPartNumber: string;
}): Promise<Result & { part?: { id: string; name: string; unit: string; mpn: string } }> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const columns = { id: true, name: true, unit: true, mpn: true } as const;
  const mpn = input.mpn.trim();
  if (mpn) {
    const part = await db.query.parts.findFirst({
      where: sql`lower(${parts.mpn}) = lower(${mpn})`,
      columns,
    });
    if (part) return { part };
  }
  const spn = input.supplierPartNumber.trim();
  // Only plain part numbers go into the regex below.
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(spn)) {
    const part = await db.query.parts.findFirst({
      where: sql`${parts.orderUrl} ~* ${`[/=]${spn}([./?&#]|$)`}`,
      columns,
    });
    if (part) return { part };
  }
  return {};
}

export async function updatePart(raw: Record<string, unknown> & { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  return mutations.updatePart(raw.id, raw);
}

export async function deletePart(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  return mutations.deletePart(input.id);
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
