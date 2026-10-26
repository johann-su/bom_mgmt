// Applying a parts import: the DB side of /parts/import, shared by its server
// action and the MCP import_parts tool. The planning (column mapping, matching
// rows to existing parts, location lookup) is the pure core in part-csv.ts;
// this module loads what the planner needs and writes the plan.

import { eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { categories, parts } from "@/db/schema";
import { loadLocationOptions } from "@/lib/locations";
import { htmlToMarkdown } from "@/lib/markdown";
import { applyDelta, recordMovement, stockAt } from "@/lib/movements";
import { mergeAttributes, type PartAttribute } from "@/lib/part-attributes";
import { mergeOrderUrls } from "@/lib/part-input";
import { revalidateInventory } from "@/lib/part-mutations";
import {
  partTableFromRows,
  planPartImport,
  sanitizeMapping,
  sanitizeRows,
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
  attributes: PartAttribute[];
};

export type PartImportResult = {
  error?: string;
  summary?: ReturnType<typeof summarizePlan>;
  errors?: PartImportPlan["errors"];
  preview?: PartImportPreviewRow[];
};

const PREVIEW_ROWS = 200;

/**
 * Imports parts from a spreadsheet's rows (CSV or .xlsx, parsed in the
 * browser, or rows an MCP client sent) with a column mapping. With
 * `dryRun` nothing is written — the preview the page shows while the mapping
 * is being adjusted. Stock rows are booked as "add" movements (`add`), or as
 * a stock-take setting the location's count (`set`), which makes
 * re-importing the same inventory sheet idempotent.
 */
export async function runPartImport(
  userId: string,
  input: {
    rows: unknown;
    mapping: unknown;
    stockMode: StockImportMode;
    dryRun: boolean;
    /** Stored on the stock movements the import books. */
    note?: string;
  },
): Promise<PartImportResult> {
  const rows = sanitizeRows(input.rows);
  if (!rows) return { error: "The file is too large or unreadable" };

  const table = partTableFromRows(rows);
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
        location: !row.stock
          ? ""
          : row.stock.locationId
            ? (codeById.get(row.stock.locationId) ?? "")
            : "Unsorted",
        quantity: row.stock?.quantity ?? null,
        attributes: row.values.attributes ?? [],
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
      const { category, attributes, orderUrls, ...values } = row.values;
      const set: Partial<typeof parts.$inferInsert> = {
        ...values,
        ...(category ? { categoryId: categoryIds.get(category.toLowerCase()) ?? null } : {}),
      };
      let partId: string;
      if ("created" in row.target && row.target.created === i) {
        const [part] = await tx
          .insert(parts)
          .values({
            ...set,
            name: values.name ?? values.mpn ?? "",
            attributes: attributes ?? [],
            orderUrls: orderUrls ?? [],
            createdBy: userId,
          })
          .returning({ id: parts.id });
        partId = part.id;
        createdIds[i] = partId;
      } else {
        partId = "existing" in row.target ? row.target.existing : createdIds[row.target.created];
        if (attributes || orderUrls) {
          // Read inside the transaction: an earlier row may have merged some already.
          const current = await tx.query.parts.findFirst({
            where: eq(parts.id, partId),
            columns: { attributes: true, orderUrls: true },
          });
          if (attributes) set.attributes = mergeAttributes(current?.attributes ?? [], attributes);
          // Another shop's export adds that supplier; known links keep their place.
          if (orderUrls) set.orderUrls = mergeOrderUrls(current?.orderUrls ?? [], orderUrls);
        }
        if (Object.keys(set).length) {
          await tx.update(parts).set({ ...set, updatedAt: new Date() }).where(eq(parts.id, partId));
        }
      }

      if (!row.stock) continue;
      const { locationId, quantity } = row.stock;
      let delta = quantity;
      if (input.stockMode === "set") {
        const current = await tx.query.stock.findFirst({
          where: stockAt(partId, locationId),
          columns: { quantity: true },
        });
        delta = quantity - (current?.quantity ?? 0);
      }
      // A location at 0 is recorded as the part's home; an unsorted pile at
      // 0 means nothing, so no row for it.
      if (delta === 0 && locationId === null) continue;
      // Never fails: "add" only adds, "set" lands on a non-negative count.
      await applyDelta(tx, partId, locationId, delta);
      if (delta !== 0) {
        await recordMovement(tx, {
          partId,
          kind: input.stockMode === "set" ? "adjust" : "add",
          quantity: delta,
          locationId,
          codes,
          note: input.note ?? "CSV import",
          userId: userId,
        });
      }
    }
  });

  revalidateInventory();
  return { summary, errors: plan.errors };
}

// Category ids by lower-cased name, creating the ones that don't exist yet.
export async function ensureCategories(tx: Tx, names: string[]) {
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
