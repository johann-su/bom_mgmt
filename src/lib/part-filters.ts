import type { PartAttribute } from "@/lib/part-attributes";
import { isLowStock, TRACKING_MODES, type Tracking } from "@/lib/stock";

// The parts list's filters: a list of conditions that must all hold, each
// "<field> is any of <values>" or, negated, "is none of". They live in the
// URL as repeated ?f= params so a filtered list can be bookmarked:
//
//   f=stock:empty,low            stock status is empty or low
//   f=!category:<id>             not in that category
//   f=attr.Drive:Hex             attribute Drive is Hex
//   f=attr.Drive~hex             attribute Drive contains "hex"
//   f=attr.Drive                 has a Drive attribute at all
//   f=!attr.Drive                has no Drive attribute
//
// Keys and values are URI-encoded individually, so ":" and "," inside an
// attribute value can't break the format. Matching runs in JS on the loaded
// list (like sorting, src/lib/parts-list-view.ts) so it can use location
// codes and stock status the way the table shows them.

/** How a part's stock reads at a glance; exclusive, in order of urgency. */
export const STOCK_STATUSES = ["empty", "low", "plenty", "untracked"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  empty: "Empty",
  low: "Low",
  plenty: "In stock",
  untracked: "Not tracked",
};

export function stockStatus(p: { tracking: Tracking; total: number; minStock: number | null }): StockStatus {
  if (p.tracking === "none") return "untracked";
  if (p.total <= 0) return "empty";
  return isLowStock(p.total, p.minStock, p.tracking) ? "low" : "plenty";
}

export const FILTER_FIELDS = [
  "stock",
  "category",
  "location",
  "manufacturer",
  "tracking",
  "unsorted",
  "attr",
] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export type PartFilter = {
  field: FilterField;
  // "is none of" instead of "is any of".
  negate: boolean;
  // Attribute name; only for "attr".
  key?: string;
  // Any of these matches. Empty for "unsorted" and for "has attribute".
  // category "" = uncategorised.
  values: string[];
  // Attribute value contains this text (case-insensitive) — for values that
  // vary in detail ("Hex socket 2 mm", "Hex socket 3 mm"). Only for "attr",
  // instead of `values`.
  contains?: string;
};

// encodeURIComponent leaves "~" alone, but it separates "contains" text here.
const encode = (text: string) => encodeURIComponent(text).replace(/~/g, "%7E");

function fieldOf(raw: string): FilterField | null {
  return (FILTER_FIELDS as readonly string[]).includes(raw) ? (raw as FilterField) : null;
}

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** One ?f= value as a filter, or null when it's malformed or meaningless. */
export function parseFilter(raw: string): PartFilter | null {
  const negate = raw.startsWith("!");
  const body = negate ? raw.slice(1) : raw;
  const sep = body.search(/[:~]/);
  const head = sep < 0 ? body : body.slice(0, sep);
  const rest = sep < 0 ? "" : body.slice(sep + 1);
  const contains = sep >= 0 && body[sep] === "~" ? decode(rest)?.trim() : undefined;
  const values = sep < 0 || contains !== undefined ? [] : rest.split(",").map(decode);
  if (contains === null || values.some((v) => v === null)) return null;
  const clean = [...new Set(values as string[])];

  const dot = head.indexOf(".");
  const field = fieldOf(dot < 0 ? head : head.slice(0, dot));
  if (!field) return null;
  if (field === "attr") {
    const key = dot < 0 ? null : decode(head.slice(dot + 1))?.trim();
    if (!key) return null;
    if (contains) return { field, negate, key, values: [], contains };
    return { field, negate, key, values: clean.filter(Boolean) };
  }
  if (field === "unsorted") return { field, negate, values: [] };
  const allowed: readonly string[] | null =
    field === "stock" ? STOCK_STATUSES : field === "tracking" ? TRACKING_MODES : null;
  // "" is a value only for category (uncategorised).
  const kept = clean.filter((v) => (allowed ? allowed.includes(v) : v !== "" || field === "category"));
  return kept.length ? { field, negate, values: kept } : null;
}

export function serializeFilter(f: PartFilter): string {
  const head = f.field === "attr" ? `attr.${encode(f.key ?? "")}` : f.field;
  const tail = f.contains
    ? `~${encode(f.contains)}`
    : f.values.length
      ? `:${f.values.map(encode).join(",")}`
      : "";
  return `${f.negate ? "!" : ""}${head}${tail}`;
}

/**
 * Filters from search params: every ?f=, plus the older single-purpose
 * params (?category=, ?location=, ?low=1, ?unsorted=1) that existing links
 * and bookmarks still use.
 */
export function parseFilterParams(params: {
  f?: string | string[];
  category?: string;
  location?: string;
  low?: string;
  unsorted?: string;
}): PartFilter[] {
  const raw = params.f === undefined ? [] : Array.isArray(params.f) ? params.f : [params.f];
  const out = raw.map(parseFilter).filter((f): f is PartFilter => f !== null);
  if (params.category) out.push({ field: "category", negate: false, values: [params.category] });
  if (params.location) out.push({ field: "location", negate: false, values: [params.location] });
  if (params.low === "1") out.push({ field: "stock", negate: false, values: ["empty", "low"] });
  if (params.unsorted === "1") out.push({ field: "unsorted", negate: false, values: [] });
  return out;
}

export type FilterablePart = {
  categoryId: string | null;
  manufacturer: string;
  tracking: Tracking;
  total: number;
  minStock: number | null;
  attributes: PartAttribute[];
  // Every location the part has a stock row in, empty ones included — an
  // empty bin is still the part's home.
  locationIds: string[];
  // Has stock that isn't put away in a location yet.
  unsorted: boolean;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A predicate for all filters together. `subtree` expands a location to
 * itself plus everything inside it, so "in box 1B" matches parts in its bins.
 */
export function compileFilters(
  filters: PartFilter[],
  subtree: (locationId: string) => Iterable<string>,
): (part: FilterablePart) => boolean {
  const tests = filters.map((f): ((p: FilterablePart) => boolean) => {
    const values = new Set(f.values);
    const positive: (p: FilterablePart) => boolean = (() => {
      switch (f.field) {
        case "stock":
          return (p) => values.has(stockStatus(p));
        case "category":
          return (p) => values.has(p.categoryId ?? "");
        case "location": {
          const inside = new Set(f.values.flatMap((id) => [...subtree(id)]));
          return (p) => p.locationIds.some((id) => inside.has(id));
        }
        case "manufacturer":
          return (p) => f.values.some((v) => same(v, p.manufacturer));
        case "tracking":
          return (p) => values.has(p.tracking);
        case "unsorted":
          return (p) => p.unsorted;
        case "attr":
          return (p) => {
            const attr = p.attributes.find((a) => same(a.key, f.key ?? ""));
            if (!attr) return false;
            if (f.contains) return attr.value.toLowerCase().includes(f.contains.toLowerCase());
            return f.values.length === 0 || f.values.some((v) => same(v, attr.value));
          };
      }
    })();
    return f.negate ? (p) => !positive(p) : positive;
  });
  return (p) => tests.every((t) => t(p));
}

// --- Editing ---
//
// The filter panel edits "the filter for a field" (for attributes, for one
// key): at most one per field/key, created on the first checked value and
// dropped when the last one is unchecked.

function sameTarget(f: PartFilter, field: FilterField, key?: string): boolean {
  return f.field === field && (field !== "attr" || same(f.key ?? "", key ?? ""));
}

/** The filter the panel shows for a field (and attribute key), if any. */
export function findFilter(filters: PartFilter[], field: FilterField, key?: string): PartFilter | undefined {
  return filters.find((f) => sameTarget(f, field, key));
}

/**
 * Replaces the filter for a field/key with what `update` returns, in place;
 * null removes it, and a new one is appended.
 */
export function updateFilter(
  filters: PartFilter[],
  field: FilterField,
  key: string | undefined,
  update: (current: PartFilter | undefined) => PartFilter | null,
): PartFilter[] {
  const i = filters.findIndex((f) => sameTarget(f, field, key));
  const next = update(i < 0 ? undefined : filters[i]);
  if (i < 0) return next ? [...filters, next] : filters;
  return next ? filters.map((f, j) => (j === i ? next : f)) : filters.filter((_, j) => j !== i);
}

/**
 * Checks or unchecks one value; leaves "contains" mode for an attribute. A
 * filter created by this gets `negateIfNew` ("is not" picked before any value).
 */
export function toggleFilterValue(
  filters: PartFilter[],
  field: FilterField,
  key: string | undefined,
  value: string,
  negateIfNew = false,
): PartFilter[] {
  return updateFilter(filters, field, key, (current) => {
    const values = current?.values ?? [];
    const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    if (next.length === 0) return null;
    const k = current?.key ?? key;
    return { field, negate: current?.negate ?? negateIfNew, ...(k ? { key: k } : {}), values: next };
  });
}
