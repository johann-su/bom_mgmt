// Validated API bodies (schemas.ts) → what the mutation core takes
// (src/lib/part-mutations.ts). Pure, so the rules are unit-tested. Nothing
// here re-implements validation: parsePartInput and the stock functions still
// decide what a valid part or booking is. What this module owns:
//
//  - the PATCH merge. The core's updatePart replaces every field with the
//    complete part form, so everything a PATCH leaves out is filled in from
//    the part as it is now — the one thing worth getting wrong here;
//  - stock levels by name ("plenty") instead of the stored scale (2);
//  - locations by id or code, the way a script names them.

import type { GenericSpec } from "@/lib/generic-parts";
import type { PartAttribute } from "@/lib/part-attributes";
import type { StockChangeMode } from "@/lib/part-mutations";
import { STOCK_LEVELS, type Tracking } from "@/lib/stock";
import type {
  ApiStockLevelOut,
  CreatePartBodyIn,
  StockChangeBodyIn,
  StockMoveBodyIn,
  UpdatePartBodyIn,
} from "./schemas";

type Failure = { error: string };

/**
 * A location by what a client calls it: its id, or its code ("A/1/IV") —
 * exactly first, then case-insensitively when that names just one, since
 * labels like "IV" and "iv" are distinct only in theory.
 */
export function resolveLocationRef<T extends { id: string; code: string }>(
  locations: T[],
  ref: string,
): { location: T } | Failure {
  const wanted = ref.trim();
  const exact = locations.find((l) => l.id === wanted || l.code === wanted);
  if (exact) return { location: exact };
  const folded = locations.filter((l) => l.code.toLowerCase() === wanted.toLowerCase());
  if (folded.length === 1) return { location: folded[0] };
  return {
    error:
      folded.length > 1
        ? `Location code "${wanted}" is ambiguous in this case — use its exact code or id`
        : `Unknown location "${wanted}" — pass a location id or code (GET /locations lists them)`,
  };
}

/** A body's place field (`null` = the unsorted pile) as a stock location id. */
export function resolvePlace(
  locations: { id: string; code: string }[],
  ref: string | null,
  field: string,
): { id: string | null } | Failure {
  if (ref === null) return { id: null };
  const found = resolveLocationRef(locations, ref);
  return "error" in found ? { error: `${field}: ${found.error}` } : { id: found.location.id };
}

/** The stored value of a level name for a part, or why it can't take one. */
export function levelValue(tracking: Tracking, level: ApiStockLevelOut): { value: number } | Failure {
  if (tracking === "exact" || tracking === "none") {
    return { error: `This part is tracked ${tracking === "exact" ? "by count" : "not at all"} — it has no level` };
  }
  if (tracking === "binary" && level === "low") {
    return { error: "A binary part is either empty (out of stock) or plenty (in stock)" };
  }
  return { value: STOCK_LEVELS[level] };
}

/** The part form's values, as parsePartInput reads them. */
export type PartFormValues = {
  name: string;
  description: string;
  mpn: string;
  manufacturer: string;
  categoryId: string;
  unit: string;
  tracking: Tracking;
  minStock: string;
  orderUrls: string[];
  icon: string;
  attributes: PartAttribute[];
  notes: string;
  generic?: GenericSpec | null;
};

const minStockValue = (minStock: number | null) => (minStock === null ? "" : String(minStock));

/**
 * The core's createPart input for a new part. `categoryId` and
 * `stockLocationId` are resolved by the caller (from categoryId/categoryName
 * and stock.location). Initial stock must fit the tracking mode: a count for
 * exact parts, a level for level/binary ones, only a location for untracked
 * ones — the core would quietly ignore the wrong one.
 */
export function createPartValues(
  body: CreatePartBodyIn,
  resolved: { categoryId: string | null; stockLocationId: string | null },
): { values: PartFormValues & { initialLocationId: string | null; initialQuantity: string } } | Failure {
  const tracking = body.tracking ?? "exact";
  let initialQuantity = "";
  if (body.stock) {
    const { quantity, level } = body.stock;
    if (tracking === "exact") {
      if (level !== undefined) return { error: "stock.level is for level/binary parts — an exact part takes stock.quantity" };
      if (quantity !== undefined) initialQuantity = String(quantity);
    } else if (tracking === "none") {
      if (quantity !== undefined || level !== undefined) {
        return { error: "An untracked part only takes stock.location — where it lives" };
      }
    } else {
      if (quantity !== undefined) return { error: `stock.quantity is for exact parts — a ${tracking} part takes stock.level` };
      if (level !== undefined) {
        const stored = levelValue(tracking, level);
        if ("error" in stored) return stored;
        initialQuantity = String(stored.value);
      }
    }
  }
  return {
    values: {
      name: body.name,
      description: body.description ?? "",
      mpn: body.mpn ?? "",
      manufacturer: body.manufacturer ?? "",
      categoryId: resolved.categoryId ?? "",
      // Blank means the default ("pcs").
      unit: body.unit ?? "",
      tracking,
      minStock: minStockValue(body.minStock ?? null),
      orderUrls: body.orderUrls ?? [],
      icon: body.icon ?? "",
      attributes: body.attributes ?? [],
      notes: body.notes ?? "",
      initialLocationId: resolved.stockLocationId,
      initialQuantity,
    },
  };
}

/** The editable fields of a stored part, as the PATCH merge sees them. */
export type StoredPart = {
  name: string;
  description: string;
  categoryId: string | null;
  manufacturer: string;
  mpn: string;
  unit: string;
  tracking: Tracking;
  minStock: number | null;
  orderUrls: string[];
  icon: string;
  attributes: PartAttribute[];
  generic: GenericSpec | null;
  notes: string;
};

/**
 * The complete part form for a PATCH: the stored part with only the sent
 * fields changed. `categoryId` is resolved by the caller — undefined when the
 * patch names no category (keep it), null to clear it. Lists (orderUrls,
 * attributes) are replaced whole, as JSON merge-patch does.
 */
export function updatePartValues(
  current: StoredPart,
  patch: UpdatePartBodyIn,
  categoryId: string | null | undefined,
): PartFormValues {
  return {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    mpn: patch.mpn ?? current.mpn,
    manufacturer: patch.manufacturer ?? current.manufacturer,
    // null is a value here (no category), so only undefined keeps it.
    categoryId: (categoryId === undefined ? current.categoryId : categoryId) ?? "",
    unit: patch.unit ?? current.unit,
    tracking: patch.tracking ?? current.tracking,
    minStock: minStockValue(patch.minStock === undefined ? current.minStock : patch.minStock),
    orderUrls: patch.orderUrls ?? current.orderUrls,
    icon: patch.icon ?? current.icon,
    attributes: patch.attributes ?? current.attributes,
    notes: patch.notes ?? current.notes,
    // Not editable through the API; carried so a PATCH can't drop the
    // generic-part wizard's stored choice.
    generic: current.generic,
  };
}

type PartRef = { id: string; tracking: Tracking };

/** The core's changeStock input for POST /parts/{id}/stock. */
export function stockChangeInput(
  part: PartRef,
  body: StockChangeBodyIn,
  locationId: string | null,
):
  | { input: { partId: string; locationId: string | null; mode: StockChangeMode; quantity?: string; note?: string } }
  | Failure {
  let quantity: string | undefined;
  if (body.mode === "level") {
    const stored = levelValue(part.tracking, body.level);
    if ("error" in stored) return stored;
    quantity = String(stored.value);
  } else if (body.mode !== "place") {
    quantity = String(body.quantity);
  }
  return { input: { partId: part.id, locationId, mode: body.mode, quantity, note: body.note } };
}

/**
 * The core's moveStock input for POST /parts/{id}/stock/move. A level,
 * binary or untracked part can't be split, so it always moves everything —
 * a quantity for one is refused rather than ignored, since moving all when
 * three were asked for would be a surprise.
 */
export function stockMoveInput(
  part: PartRef,
  body: StockMoveBodyIn,
  places: { from: string | null; to: string | null },
):
  | { input: { partId: string; fromLocationId: string | null; toLocationId: string | null; quantity: string; note?: string } }
  | Failure {
  if (part.tracking === "exact" && body.quantity === undefined) {
    return { error: "quantity is required to move a counted part's stock" };
  }
  if (part.tracking !== "exact" && body.quantity !== undefined) {
    return { error: `A ${part.tracking === "none" ? "untracked" : part.tracking} part moves as a whole — leave out quantity` };
  }
  return {
    input: {
      partId: part.id,
      fromLocationId: places.from,
      toLocationId: places.to,
      quantity: body.quantity === undefined ? "" : String(body.quantity),
      note: body.note,
    },
  };
}
