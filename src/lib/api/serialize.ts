// DB rows → the API's response shapes (src/lib/api/schemas.ts). Pure — rows
// in, plain objects out — so what the API exposes is unit-tested, and every
// field is projected by hand: spreading a row would publish whatever column
// is added to it next (storage keys, label slots, who created a part).
//
// URLs are absolute and built by the caller's `url` (appUrl in the routes),
// never from the request, which behind a proxy is the internal bind address.

import type { files } from "@/db/schema";
import type { PartAttribute } from "@/lib/part-attributes";
import { isLowStock, STOCK_LEVELS, type LineRequirement, type MovementKind, type Tracking } from "@/lib/stock";
import type {
  ApiBomDetailOut,
  ApiBomLineOut,
  ApiBomOut,
  ApiFileOut,
  ApiLocationDetailOut,
  ApiLocationOut,
  ApiMovementOut,
  ApiPartDetailOut,
  ApiPartOut,
  ApiStockEntryOut,
  ApiStockLevelOut,
  ApiStockValueOut,
} from "./schemas";

export type UrlFor = (path: string) => string;

export type LocationRef = { id: string; code: string; path: string };

export const fileDownloadPath = (fileId: string) => `/api/v1/files/${fileId}`;

// --- Stock ------------------------------------------------------------------

/** A stored level as its name; binary parts read anything above empty as plenty (in stock). */
export function levelName(tracking: Tracking, stored: number): ApiStockLevelOut {
  if (stored >= STOCK_LEVELS.plenty) return "plenty";
  if (stored <= STOCK_LEVELS.empty) return "empty";
  return tracking === "binary" ? "plenty" : "low";
}

/** A stored stock value as the API shows it: a count, a level, or neither. */
export function stockValue(tracking: Tracking, stored: number): ApiStockValueOut {
  if (tracking === "exact") return { quantity: stored, level: null };
  if (tracking === "none") return { quantity: null, level: null };
  return { quantity: null, level: levelName(tracking, stored) };
}

const natural = new Intl.Collator("en", { numeric: true });

// Where a part is: the unsorted pile first (left out once it's empty — it
// isn't a place), then locations by code. Empty locations stay: they are the
// part's home, where it goes when restocked.
function stockEntries(
  tracking: Tracking,
  rows: { location: LocationRef | null; quantity: number }[],
): ApiStockEntryOut[] {
  return rows
    .filter((row) => row.location !== null || row.quantity > 0)
    .sort((a, b) =>
      a.location === null ? -1 : b.location === null ? 1 : natural.compare(a.location.code, b.location.code),
    )
    .map((row) => ({
      location: row.location && { id: row.location.id, code: row.location.code, path: row.location.path },
      ...stockValue(tracking, row.quantity),
    }));
}

// --- Parts ------------------------------------------------------------------

type FileRow = Pick<typeof files.$inferSelect, "id" | "kind" | "filename" | "size" | "position" | "createdAt">;

export type PartRow = {
  id: string;
  name: string;
  mpn: string;
  manufacturer: string;
  category: { id: string; name: string } | null;
  unit: string;
  tracking: Tracking;
  minStock: number | null;
  orderUrls: string[];
  icon: string;
  attributes: PartAttribute[];
  /** totalStock: the sum (exact), the best level (level/binary), 0 (untracked). */
  total: number;
  stock: { location: LocationRef | null; quantity: number }[];
  coverImageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PartDetailRow = PartRow & {
  description: string;
  notes: string;
  files: FileRow[];
  boms: { id: string; name: string; perUnit: number }[];
};

export function serializeFile(file: FileRow, url: UrlFor): ApiFileOut {
  return {
    id: file.id,
    kind: file.kind,
    filename: file.filename,
    size: file.size,
    position: file.position,
    downloadUrl: url(fileDownloadPath(file.id)),
    createdAt: file.createdAt.toISOString(),
  };
}

export function serializePart(row: PartRow, url: UrlFor): ApiPartOut {
  return {
    id: row.id,
    name: row.name,
    mpn: row.mpn,
    manufacturer: row.manufacturer,
    category: row.category && { id: row.category.id, name: row.category.name },
    unit: row.unit,
    tracking: row.tracking,
    inStock: stockValue(row.tracking, row.total),
    minStock: row.minStock,
    lowStock: isLowStock(row.total, row.minStock, row.tracking),
    stock: stockEntries(row.tracking, row.stock),
    orderUrls: [...row.orderUrls],
    icon: row.icon,
    attributes: row.attributes.map((a) => ({ key: a.key, value: a.value })),
    imageUrl: row.coverImageId ? url(fileDownloadPath(row.coverImageId)) : null,
    url: url(`/parts/${row.id}`),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializePartDetail(row: PartDetailRow, url: UrlFor): ApiPartDetailOut {
  return {
    ...serializePart(row, url),
    description: row.description,
    notes: row.notes,
    files: [...row.files]
      .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
      .map((file) => serializeFile(file, url)),
    boms: row.boms.map((b) => ({ id: b.id, name: b.name, perUnit: b.perUnit, url: url(`/boms/${b.id}`) })),
  };
}

// --- Movements ----------------------------------------------------------------

export type MovementRow = {
  id: string;
  kind: MovementKind;
  quantity: number;
  partId: string;
  partName: string;
  locationId: string | null;
  locationPath: string;
  toLocationId: string | null;
  toLocationPath: string;
  bomId: string | null;
  bomName: string | null;
  note: string;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
};

// A movement names its places by the code they had at the time. No id and no
// code is the unsorted pile; no id but a code is a location deleted since.
function movementPlace(id: string | null, code: string) {
  return id === null && code === "" ? null : { id, code };
}

export function serializeMovement(row: MovementRow): ApiMovementOut {
  return {
    id: row.id,
    kind: row.kind,
    quantity: row.quantity,
    part: { id: row.partId, name: row.partName },
    location: movementPlace(row.locationId, row.locationPath),
    toLocation: row.kind === "move" ? movementPlace(row.toLocationId, row.toLocationPath) : null,
    bom: row.bomId && row.bomName !== null ? { id: row.bomId, name: row.bomName } : null,
    note: row.note,
    user: row.userId && row.userName !== null ? { id: row.userId, name: row.userName } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Locations ----------------------------------------------------------------

export type LocationRow = LocationRef & {
  label: string;
  name: string;
  description: string;
  type: { id: string; name: string };
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeLocation(row: LocationRow, url: UrlFor): ApiLocationOut {
  return {
    id: row.id,
    code: row.code,
    path: row.path,
    label: row.label,
    name: row.name,
    description: row.description,
    type: { id: row.type.id, name: row.type.name },
    parentId: row.parentId,
    url: url(`/locations/${row.id}`),
    partsUrl: url(`/api/v1/parts?location=${row.id}`),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeLocationDetail(
  row: LocationRow,
  children: LocationRef[],
  url: UrlFor,
): ApiLocationDetailOut {
  return {
    ...serializeLocation(row, url),
    children: children.map((c) => ({ id: c.id, code: c.code, path: c.path })),
  };
}

// --- BOMs -----------------------------------------------------------------------

export type BomRow = {
  id: string;
  name: string;
  description: string;
  lineCount: number;
  buildable: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BomLineRow = LineRequirement & {
  name: string;
  mpn: string;
  manufacturer: string;
  unit: string;
  tracking: Tracking;
  reference: string;
  notes: string;
};

export function serializeBom(row: BomRow, url: UrlFor): ApiBomOut {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    lineCount: row.lineCount,
    buildableUnits: row.buildable,
    url: url(`/boms/${row.id}`),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeBomLine(line: BomLineRow): ApiBomLineOut {
  return {
    part: {
      id: line.partId,
      name: line.name,
      mpn: line.mpn,
      manufacturer: line.manufacturer,
      unit: line.unit,
      tracking: line.tracking,
    },
    perUnit: line.perUnit,
    reference: line.reference,
    notes: line.notes,
    inStock: stockValue(line.tracking, line.inStock),
    required: line.required,
    shortfall: line.shortfall,
  };
}

export function serializeBomDetail(
  row: BomRow,
  lines: BomLineRow[],
  units: number,
  url: UrlFor,
): ApiBomDetailOut {
  return { ...serializeBom(row, url), units, lines: lines.map(serializeBomLine) };
}
