// The read side of /api/v1. Part filters reuse the parts list's own SQL
// (src/lib/part-queries.ts) — search, low stock, total stock — so the API
// finds what the app finds. Locations are loaded whole and described in
// memory, like every page does (a workshop has hundreds, not millions).

import { and, asc, count, desc, eq, exists, gt, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { bomItems, boms, categories, files, parts, stock, stockMovements, user } from "@/db/schema";
import { listBoms, loadBomLines } from "@/lib/bom-queries";
import { loadLocationOptions, loadLocations } from "@/lib/locations";
import { describeAll, subtreeIds } from "@/lib/location-tree";
import { lowStockFilter, partSearchFilter, totalStock } from "@/lib/part-queries";
import { getCodeSeparator } from "@/lib/settings";
import { buildableUnits, requirements } from "@/lib/stock";
import {
  encodeCursor,
  sortsByTime,
  type Cursor,
  type MovementListQuery,
  type PartListQuery,
  type PartSort,
} from "./params";
import type { StoredPart } from "./translate";
import type {
  BomLineRow,
  BomRow,
  LocationRef,
  LocationRow,
  MovementRow,
  PartDetailRow,
  PartRow,
} from "./serialize";

// Exact, DateStyle-independent text form of a timestamp for cursors — see
// params.ts for why it isn't a JS Date.
const cursorText = (col: PgColumn) => sql<string>`to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.US')`;

// Rows after the cursor in (sort key, id) order. A row comparison matches
// ORDER BY key, id exactly — including the column's collation for names.
function keyset(col: PgColumn, idCol: PgColumn, descending: boolean, cursor: Cursor | null): SQL | undefined {
  if (!cursor) return undefined;
  const at = sortsByTime(cursor.sort) ? sql`${cursor.at}::timestamp` : sql`${cursor.at}`;
  return descending
    ? sql`(${col}, ${idCol}) < (${at}, ${cursor.id}::uuid)`
    : sql`(${col}, ${idCol}) > (${at}, ${cursor.id}::uuid)`;
}

// Queries fetch limit + 1 rows: the extra one says whether there is a next
// page. Rows keep their `at` (the cursor text); serializers project field by
// field, so it never reaches a response.
function page<T extends { id: string; at: string }>(rows: T[], limit: number, sort: string) {
  const hasMore = rows.length > limit;
  const shown = hasMore ? rows.slice(0, limit) : rows;
  const last = shown[shown.length - 1];
  return { rows: shown, nextCursor: hasMore && last ? encodeCursor(sort, last.at, last.id) : null };
}

// --- Parts ------------------------------------------------------------------

const PART_SORT: Record<PartSort, { col: PgColumn; descending: boolean }> = {
  name_asc: { col: parts.name, descending: false },
  created_desc: { col: parts.createdAt, descending: true },
  created_asc: { col: parts.createdAt, descending: false },
  updated_desc: { col: parts.updatedAt, descending: true },
  updated_asc: { col: parts.updatedAt, descending: false },
};

const partColumns = {
  id: parts.id,
  name: parts.name,
  mpn: parts.mpn,
  manufacturer: parts.manufacturer,
  unit: parts.unit,
  tracking: parts.tracking,
  minStock: parts.minStock,
  orderUrls: parts.orderUrls,
  icon: parts.icon,
  attributes: parts.attributes,
  categoryId: parts.categoryId,
  categoryName: categories.name,
  total: totalStock,
  createdAt: parts.createdAt,
  updatedAt: parts.updatedAt,
};

type PartBase = Omit<PartRow, "category" | "stock" | "coverImageId"> & {
  categoryId: string | null;
  categoryName: string | null;
};

type Decorated<T extends PartBase> = Omit<T, "categoryId" | "categoryName"> &
  Pick<PartRow, "category" | "stock" | "coverImageId">;

// Each part's category, stock rows with their locations, and thumbnail — one
// query per relation for the whole page rather than one per part.
async function decorate<T extends PartBase>(rows: T[]): Promise<Decorated<T>[]> {
  const ids = rows.map((r) => r.id);
  const [stockRows, covers, options] = await Promise.all([
    ids.length
      ? db
          .select({ partId: stock.partId, locationId: stock.locationId, quantity: stock.quantity })
          .from(stock)
          .where(inArray(stock.partId, ids))
      : [],
    ids.length
      ? db
          .selectDistinctOn([files.partId], { partId: files.partId, id: files.id })
          .from(files)
          .where(and(inArray(files.partId, ids), eq(files.kind, "image")))
          .orderBy(files.partId, files.position, files.createdAt)
      : [],
    loadLocationOptions(),
  ]);
  const placeById = new Map(options.map((l) => [l.id, { id: l.id, code: l.code, path: l.path }]));
  const coverByPart = new Map(covers.map((c) => [c.partId, c.id]));
  return rows.map(({ categoryId, categoryName, ...row }) => ({
    ...row,
    category: categoryId && categoryName !== null ? { id: categoryId, name: categoryName } : null,
    stock: stockRows
      .filter((s) => s.partId === row.id)
      .flatMap((s): PartRow["stock"] => {
        if (s.locationId === null) return [{ location: null, quantity: s.quantity }];
        // Every stock location is in the options (the FK restricts deletes).
        const location = placeById.get(s.locationId);
        return location ? [{ location, quantity: s.quantity }] : [];
      }),
    coverImageId: coverByPart.get(row.id) ?? null,
  }));
}

const stockWhere = (...conditions: SQL[]) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(stock)
      .where(and(eq(stock.partId, parts.id), ...conditions)),
  );

export async function listParts(
  query: PartListQuery & { locationIds?: string[] },
): Promise<{ rows: PartRow[]; nextCursor: string | null }> {
  const { col, descending } = PART_SORT[query.sort];
  const conditions = [
    query.q ? partSearchFilter(query.q) : undefined,
    query.categoryId ? eq(parts.categoryId, query.categoryId) : undefined,
    query.mpn ? sql`lower(${parts.mpn}) = lower(${query.mpn})` : undefined,
    query.tracking ? eq(parts.tracking, query.tracking) : undefined,
    query.lowStock ? lowStockFilter : undefined,
    query.unsorted ? stockWhere(isNull(stock.locationId), gt(stock.quantity, 0)) : undefined,
    // Any stock row there counts — an emptied bin is still the part's home.
    query.locationIds ? stockWhere(inArray(stock.locationId, query.locationIds)) : undefined,
    query.updatedSince ? gte(parts.updatedAt, query.updatedSince) : undefined,
    keyset(col, parts.id, descending, query.cursor),
  ].filter((c): c is SQL => c !== undefined);

  const dir = descending ? desc : asc;
  const rows = await db
    .select({ ...partColumns, at: sortsByTime(query.sort) ? cursorText(col) : sql<string>`${parts.name}` })
    .from(parts)
    .leftJoin(categories, eq(categories.id, parts.categoryId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(dir(col), dir(parts.id))
    .limit(query.limit + 1);

  const { rows: shown, nextCursor } = page(rows, query.limit, query.sort);
  return { rows: await decorate(shown), nextCursor };
}

export async function getPartDetail(partId: string): Promise<PartDetailRow | null> {
  const [row] = await db
    .select({ ...partColumns, description: parts.description, notes: parts.notes })
    .from(parts)
    .leftJoin(categories, eq(categories.id, parts.categoryId))
    .where(eq(parts.id, partId));
  if (!row) return null;
  const [[decorated], partFiles, usedIn] = await Promise.all([
    decorate([row]),
    db
      .select({
        id: files.id,
        kind: files.kind,
        filename: files.filename,
        size: files.size,
        position: files.position,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(eq(files.partId, partId)),
    db
      .select({ id: boms.id, name: boms.name, perUnit: bomItems.quantity })
      .from(bomItems)
      .innerJoin(boms, eq(boms.id, bomItems.bomId))
      .where(eq(bomItems.partId, partId))
      .orderBy(asc(boms.name)),
  ]);
  return { ...decorated, files: partFiles, boms: usedIn };
}

/** What a PATCH merges into (translate.ts › updatePartValues). */
export async function getStoredPart(partId: string): Promise<StoredPart | null> {
  const row = await db.query.parts.findFirst({
    where: eq(parts.id, partId),
    columns: {
      name: true,
      description: true,
      categoryId: true,
      manufacturer: true,
      mpn: true,
      unit: true,
      tracking: true,
      minStock: true,
      orderUrls: true,
      icon: true,
      attributes: true,
      generic: true,
      notes: true,
    },
  });
  return row ?? null;
}

/** The part's id and tracking mode, or null when there is no such part. */
export async function findPart(partId: string) {
  const row = await db.query.parts.findFirst({
    where: eq(parts.id, partId),
    columns: { id: true, tracking: true },
  });
  return row ?? null;
}

export async function categoryExists(categoryId: string): Promise<boolean> {
  const row = await db.query.categories.findFirst({
    where: eq(categories.id, categoryId),
    columns: { id: true },
  });
  return row !== undefined;
}

export async function listCategories() {
  return db
    .select({ id: categories.id, name: categories.name, partCount: count(parts.id) })
    .from(categories)
    .leftJoin(parts, eq(parts.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
}

/** Part names by id, for describing a build's draws. */
export async function partNames(partIds: string[]): Promise<Map<string, string>> {
  if (partIds.length === 0) return new Map();
  const rows = await db
    .select({ id: parts.id, name: parts.name })
    .from(parts)
    .where(inArray(parts.id, partIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// --- Locations ----------------------------------------------------------------

/** Every location, depth-first in display order, with its code and path. */
export async function listLocations(): Promise<LocationRow[]> {
  const [rows, separator] = await Promise.all([
    db.query.locations.findMany({
      columns: {
        id: true,
        parentId: true,
        label: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
      with: { type: { columns: { id: true, name: true, icon: true, labelPattern: true, position: true } } },
    }),
    getCodeSeparator(),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return describeAll(rows, separator).map(({ id, code, path }) => {
    const row = byId.get(id)!;
    return {
      id,
      code,
      path,
      label: row.label,
      name: row.name,
      description: row.description,
      type: { id: row.type.id, name: row.type.name },
      parentId: row.parentId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function getLocation(
  locationId: string,
): Promise<{ location: LocationRow; children: LocationRef[] } | null> {
  const all = await listLocations();
  const location = all.find((l) => l.id === locationId);
  if (!location) return null;
  return { location, children: all.filter((l) => l.parentId === locationId) };
}

/** The location and every location inside it, or null when there is none. */
export async function locationSubtree(locationId: string): Promise<string[] | null> {
  const all = await loadLocations();
  if (!all.some((l) => l.id === locationId)) return null;
  return [...subtreeIds(all, locationId)];
}

// --- Movements ------------------------------------------------------------------

export async function listMovements(
  query: MovementListQuery,
): Promise<{ rows: MovementRow[]; nextCursor: string | null }> {
  const descending = query.sort === "created_desc";
  const conditions = [
    query.partId ? eq(stockMovements.partId, query.partId) : undefined,
    query.bomId ? eq(stockMovements.bomId, query.bomId) : undefined,
    query.kind ? eq(stockMovements.kind, query.kind) : undefined,
    query.since ? gte(stockMovements.createdAt, query.since) : undefined,
    keyset(stockMovements.createdAt, stockMovements.id, descending, query.cursor),
  ].filter((c): c is SQL => c !== undefined);

  const dir = descending ? desc : asc;
  const rows = await db
    .select({
      id: stockMovements.id,
      kind: stockMovements.kind,
      quantity: stockMovements.quantity,
      partId: stockMovements.partId,
      partName: parts.name,
      locationId: stockMovements.locationId,
      locationPath: stockMovements.locationPath,
      toLocationId: stockMovements.toLocationId,
      toLocationPath: stockMovements.toLocationPath,
      bomId: stockMovements.bomId,
      bomName: boms.name,
      note: stockMovements.note,
      userId: stockMovements.userId,
      userName: user.name,
      createdAt: stockMovements.createdAt,
      at: cursorText(stockMovements.createdAt),
    })
    .from(stockMovements)
    .innerJoin(parts, eq(parts.id, stockMovements.partId))
    .leftJoin(user, eq(user.id, stockMovements.userId))
    .leftJoin(boms, eq(boms.id, stockMovements.bomId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(dir(stockMovements.createdAt), dir(stockMovements.id))
    .limit(query.limit + 1);

  return page(rows, query.limit, query.sort);
}

// --- BOMs -------------------------------------------------------------------------

/** Every BOM, most recently changed first, with its line count and what stock can build. */
export async function listBomRows(): Promise<BomRow[]> {
  return (await listBoms()).map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    lineCount: b.lineCount,
    buildable: b.buildable,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }));
}

/** One BOM with its lines, and what `units` of it need and lack. */
export async function getBomDetail(
  bomId: string,
  units: number,
): Promise<{ bom: BomRow; lines: BomLineRow[] } | null> {
  const bom = await db.query.boms.findFirst({ where: eq(boms.id, bomId) });
  if (!bom) return null;
  const lines = await loadBomLines(bomId);
  const needs = requirements(lines, units);
  return {
    bom: {
      id: bom.id,
      name: bom.name,
      description: bom.description,
      lineCount: lines.length,
      buildable: buildableUnits(lines),
      createdAt: bom.createdAt,
      updatedAt: bom.updatedAt,
    },
    lines: lines.map((line, i) => ({ ...line, ...needs[i] })),
  };
}
