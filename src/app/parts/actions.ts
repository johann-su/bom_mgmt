"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, files, parts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { genericType } from "@/lib/generic-families";
import { generateRange } from "@/lib/generic-parts";
import { MAX_UPLOAD_BYTES, remoteFilename } from "@/lib/file-kind";
import * as mutations from "@/lib/part-mutations";
import { storePartFiles } from "@/lib/part-files";
import { ensureCategories } from "@/lib/part-import";
import { parseOrderUrl } from "@/lib/part-input";
import { fetchProductInfo, fetchRemoteFile } from "@/lib/product-fetch";
import type { ProductInfo } from "@/lib/product-page";
import { blobStore } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { suggestCategory } from "./product-fill";

type Result = { error?: string };

// Part writes live in src/lib/part-mutations.ts (shared with the MCP tools);
// these actions add the session check.
const revalidate = mutations.revalidateInventory;

export async function createPart(
  raw: Record<string, unknown> & { initialLocationId?: string | null; initialQuantity?: string },
): Promise<Result & { id?: string }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const resolved = await resolveNewCategory(raw);
  if ("error" in resolved) return resolved;
  return mutations.createPart(session.user.id, resolved.values);
}

// The form sends categoryId "new" plus newCategory (a name, e.g. a shop's
// suggestion the user may have shortened): that category is reused if it
// exists (case-insensitively), else created.
async function resolveNewCategory<T extends Record<string, unknown>>(
  raw: T,
): Promise<{ values: T } | { error: string }> {
  if (raw.categoryId !== "new") return { values: raw };
  const name = String(raw.newCategory ?? "").trim().slice(0, 200);
  if (!name) return { error: "Enter a name for the new category" };
  const ids = await db.transaction((tx) => ensureCategories(tx, [name]));
  revalidatePath("/settings/categories");
  return { values: { ...raw, categoryId: ids.get(name.toLowerCase()) ?? null } };
}

/**
 * Creates one generic part per range value — a screw per length, a housing
 * per pin count (src/lib/generic-parts.ts) — filed under an existing matching
 * category or a new one. The parts are generated here from the spec, not
 * taken from the client. Parts that already exist (same name or MPN) are
 * skipped, so re-running a range only adds what's new.
 */
export async function createGenericParts(input: {
  family: string;
  type: string;
  values: Record<string, string>;
  range: string[];
}): Promise<Result & { created?: number; skipped?: number }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const type = genericType(String(input.family), String(input.type));
  if (!type) return { error: "Unknown part type" };
  const values = Object.fromEntries(
    Object.entries(input.values ?? {}).map(([key, value]) => [key, String(value)]),
  );
  const generated = generateRange(type, values, Array.isArray(input.range) ? input.range.map(String) : []);
  if ("error" in generated) return generated;

  const lower = (values: string[]) => values.filter(Boolean).map((v) => v.toLowerCase());
  const names = lower(generated.map((p) => p.name));
  const mpns = lower(generated.map((p) => p.mpn));
  const existing = await db
    .select({ name: parts.name, mpn: parts.mpn })
    .from(parts)
    .where(
      or(
        inArray(sql`lower(${parts.name})`, names),
        mpns.length ? inArray(sql`lower(${parts.mpn})`, mpns) : undefined,
      ),
    );
  const taken = new Set(lower(existing.flatMap((p) => [p.name, p.mpn])));
  const fresh = generated.filter((p) => !taken.has(p.name.toLowerCase()) && !taken.has(p.mpn.toLowerCase()));
  if (fresh.length === 0) return { created: 0, skipped: generated.length };

  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories);
  const suggestion = suggestCategory(fresh[0].category, cats);
  let categoryId: string | null = null;
  if (suggestion && "id" in suggestion) categoryId = suggestion.id;
  else if (suggestion) {
    const ids = await db.transaction((tx) => ensureCategories(tx, [suggestion.name]));
    categoryId = ids.get(suggestion.name.toLowerCase()) ?? null;
    revalidatePath("/settings/categories");
  }

  let created = 0;
  for (const part of fresh) {
    // Generic parts are bulk commodities (screws, crimp housings) — kept as a
    // level rather than counted.
    const result = await mutations.createPart(session.user.id, { ...part, categoryId, tracking: "level" });
    if (result.error) return { error: result.error, created };
    created++;
  }
  return { created, skipped: generated.length - created };
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
 * order links (an LCSC "C2040" in …/product-detail/C2040.html).
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
      where: sql`exists (select 1 from unnest(${parts.orderUrls}) as u(url) where u.url ~* ${`[/=]${spn}([./?&#]|$)`})`,
      columns,
    });
    if (part) return { part };
  }
  return {};
}

export async function updatePart(raw: Record<string, unknown> & { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const resolved = await resolveNewCategory(raw);
  if ("error" in resolved) return resolved;
  return mutations.updatePart(raw.id, resolved.values);
}

/**
 * Downloads files a shop's product page linked to (datasheet, photo) and
 * attaches them to the part. Each is fetched like the page itself (public
 * addresses only) and kept only if it really is a PDF or image. Files that
 * fail are reported; the others are still attached.
 */
export async function attachShopFiles(input: {
  partId: string;
  files: { url: string; name: string }[];
}): Promise<Result & { attached?: number }> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const part = await db.query.parts.findFirst({ where: eq(parts.id, input.partId), columns: { id: true } });
  if (!part) return { error: "Part not found" };

  const downloads: { name: string; bytes: Uint8Array }[] = [];
  const failed: string[] = [];
  for (const file of input.files.slice(0, 5)) {
    const url = parseOrderUrl(file.url);
    const result = url ? await fetchRemoteFile(url, MAX_UPLOAD_BYTES) : { error: "Not a valid URL" };
    const name = "error" in result ? null : remoteFilename(file.name, result.contentType, result.url);
    if ("error" in result || !name) {
      logger.info({ url: file.url, error: "error" in result ? result.error : "not a PDF or image" }, "Shop file download failed");
      failed.push(file.name);
      continue;
    }
    downloads.push({ name, bytes: result.bytes });
  }
  if (downloads.length) {
    const stored = await storePartFiles(part.id, downloads);
    if ("error" in stored) return stored;
    revalidate(part.id);
  }
  return {
    attached: downloads.length,
    ...(failed.length ? { error: `Could not download ${failed.join(", ")}` } : {}),
  };
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
