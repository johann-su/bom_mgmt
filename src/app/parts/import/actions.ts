"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { categories, parts, stock } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { loadLocationOptions } from "@/lib/locations";
import { htmlToMarkdown } from "@/lib/markdown";
import { applyDelta, recordMovement } from "@/lib/movements";
import {
  planPartImport,
  readPartCsv,
  sanitizeMapping,
  summarizePlan,
  type PartImportPlan,
} from "@/lib/part-csv";

export type StockImportMode = "add" | "set";

export type PartImportPreviewRow = {
  line: number;
  name: string;
  mpn: string;
  action: "create" | "update";
  location: string;
  quantity: number | null;
};

export type PartImportResult = {
  error?: string;
  summary?: ReturnType<typeof summarizePlan>;
  errors?: PartImportPlan["errors"];
  preview?: PartImportPreviewRow[];
};

const PREVIEW_ROWS = 200;

/**
 * Imports parts from CSV with a column mapping chosen in the UI. With
 * `dryRun` nothing is written — the preview the page shows while the mapping
 * is being adjusted. Stock rows are booked as "add" movements (`add`), or as
 * a stock-take setting the location's count (`set`), which makes
 * re-importing the same inventory sheet idempotent.
 */
export async function importParts(input: {
  csv: string;
  mapping: unknown;
  stockMode: StockImportMode;
  dryRun: boolean;
}): Promise<PartImportResult> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  if (input.csv.length > 5_000_000) return { error: "The file is too large" };

  const table = readPartCsv(input.csv);
  if (table.headers.length === 0) return { error: "The file is empty" };
  const mapping = sanitizeMapping(input.mapping, table.headers.length);

  const [known, locations] = await Promise.all([
    db.select({ id: parts.id, name: parts.name, mpn: parts.mpn }).from(parts),
    loadLocationOptions(),
  ]);
  const plan = planPartImport(table, mapping, { parts: known, locations });
  // Shop exports (Shopify's "Body (HTML)", WooCommerce) carry HTML descriptions.
  if (!input.dryRun) {
    for (const row of plan.rows) {
      if (row.values.description) row.values.description = htmlToMarkdown(row.values.description);
    }
  }
  const summary = summarizePlan(plan);

  if (input.dryRun) {
    const nameById = new Map(known.map((p) => [p.id, p]));
    const codeById = new Map(locations.map((l) => [l.id, l.code]));
    const preview = plan.rows.slice(0, PREVIEW_ROWS).map((row, i): PartImportPreviewRow => {
      const existing = "existing" in row.target ? nameById.get(row.target.existing) : undefined;
      return {
        line: row.line,
        name: row.values.name ?? existing?.name ?? row.values.mpn ?? "",
        mpn: row.values.mpn ?? existing?.mpn ?? "",
        action: "created" in row.target && row.target.created === i ? "create" : "update",
        location: row.stock ? (codeById.get(row.stock.locationId) ?? "") : "",
        quantity: row.stock?.quantity ?? null,
      };
    });
    return { summary, errors: plan.errors, preview };
  }
  if (plan.rows.length === 0) return { error: plan.errors[0]?.message ?? "No rows to import" };

  const codes = new Map(locations.map((l) => [l.id, l.code]));
  await db.transaction(async (tx) => {
    const categoryIds = await ensureCategories(
      tx,
      plan.rows.flatMap((r) => (r.values.category ? [r.values.category] : [])),
    );
    const createdIds: string[] = [];

    for (const [i, row] of plan.rows.entries()) {
      const { category, ...values } = row.values;
      const set = {
        ...values,
        ...(category ? { categoryId: categoryIds.get(category.toLowerCase()) ?? null } : {}),
      };
      let partId: string;
      if ("created" in row.target && row.target.created === i) {
        const [part] = await tx
          .insert(parts)
          .values({ ...set, name: values.name ?? values.mpn ?? "", createdBy: session.user.id })
          .returning({ id: parts.id });
        partId = part.id;
        createdIds[i] = partId;
      } else {
        partId = "existing" in row.target ? row.target.existing : createdIds[row.target.created];
        if (Object.keys(set).length) {
          await tx.update(parts).set({ ...set, updatedAt: new Date() }).where(eq(parts.id, partId));
        }
      }

      if (!row.stock) continue;
      const { locationId, quantity } = row.stock;
      let delta = quantity;
      if (input.stockMode === "set") {
        const current = await tx.query.stock.findFirst({
          where: and(eq(stock.partId, partId), eq(stock.locationId, locationId)),
          columns: { quantity: true },
        });
        delta = quantity - (current?.quantity ?? 0);
      }
      // Never fails: "add" only adds, "set" lands on a non-negative count.
      await applyDelta(tx, partId, locationId, delta);
      if (delta !== 0) {
        await recordMovement(tx, {
          partId,
          kind: input.stockMode === "set" ? "adjust" : "add",
          quantity: delta,
          locationId,
          codes,
          note: "CSV import",
          userId: session.user.id,
        });
      }
    }
  });

  revalidatePath("/parts");
  revalidatePath("/locations", "layout");
  revalidatePath("/boms", "layout");
  revalidatePath("/");
  return { summary, errors: plan.errors };
}

// Category ids by lower-cased name, creating the ones that don't exist yet.
async function ensureCategories(tx: Tx, names: string[]) {
  const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  if (wanted.size === 0) return new Map<string, string>();
  const existing = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(inArray(sql`lower(${categories.name})`, [...wanted.keys()]));
  const ids = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  const missing = [...wanted].filter(([key]) => !ids.has(key)).map(([, name]) => ({ name }));
  if (missing.length) {
    const inserted = await tx
      .insert(categories)
      .values(missing)
      .returning({ id: categories.id, name: categories.name });
    for (const c of inserted) ids.set(c.name.toLowerCase(), c.id);
  }
  return ids;
}
