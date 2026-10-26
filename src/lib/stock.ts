import { formatQuantity } from "@/lib/format";

// Pure stock arithmetic: BOM availability and which bins a build draws from.
// The actions in src/app/parts/actions.ts and src/app/boms/actions.ts apply
// the results inside a transaction.

// "level" sets a level-tracked part's level at one location; its quantity is
// the new level (STOCK_LEVELS), not a delta.
export const MOVEMENT_KINDS = ["add", "remove", "move", "adjust", "build", "level"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

// --- Tracking modes ---
//
// How a part's stock is kept. Counting every screw is tedious and drifts the
// moment one is used without booking it, so cheap bulk parts can be tracked
// coarsely instead:
//  - exact:  a count per location (the default)
//  - level:  plenty / low / empty per location
//  - binary: in stock / out of stock per location
//  - none:   only where it lives (tools, jigs, parts bought per project)
// Level and binary parts keep their level in stock.quantity on one shared
// scale (STOCK_LEVELS) — binary uses only empty and plenty — so switching
// between the two keeps what is known, and history stays readable.
export const TRACKING_MODES = ["exact", "level", "binary", "none"] as const;
export type Tracking = (typeof TRACKING_MODES)[number];

export const TRACKING_INFO: Record<Tracking, { label: string; hint: string }> = {
  exact: { label: "Exact count", hint: "Every piece is counted; builds take them out of stock." },
  level: { label: "Level", hint: "Plenty, low or empty — for bulk parts not worth counting." },
  binary: { label: "In stock / out", hint: "Only whether there are any left." },
  none: { label: "Not tracked", hint: "Only where it lives; never runs low, never limits a build." },
};

export function isTracking(value: unknown): value is Tracking {
  return (TRACKING_MODES as readonly unknown[]).includes(value);
}

export const STOCK_LEVELS = { empty: 0, low: 1, plenty: 2 } as const;

/** The levels a part can be set to, lowest first; none for exact/untracked parts. */
export function levelChoices(tracking: Tracking): { value: number; label: string }[] {
  if (tracking === "level") {
    return [
      { value: STOCK_LEVELS.empty, label: "Empty" },
      { value: STOCK_LEVELS.low, label: "Low" },
      { value: STOCK_LEVELS.plenty, label: "Plenty" },
    ];
  }
  if (tracking === "binary") {
    return [
      { value: STOCK_LEVELS.empty, label: "Out of stock" },
      { value: STOCK_LEVELS.plenty, label: "In stock" },
    ];
  }
  return [];
}

/** A stored level as text; binary parts read anything above empty as "In stock". */
export function levelLabel(tracking: Tracking, level: number): string {
  if (tracking === "binary") return level > STOCK_LEVELS.empty ? "In stock" : "Out of stock";
  return (
    levelChoices("level").find((c) => c.value === level)?.label ??
    (level > STOCK_LEVELS.plenty ? "Plenty" : "Empty")
  );
}

/** A stock value as shown: "12 pcs", "Low", "In stock", or "—" when untracked. */
export function formatStock(tracking: Tracking, quantity: number, unit: string): string {
  if (tracking === "exact") return formatQuantity(quantity, unit);
  if (tracking === "none") return "—";
  return levelLabel(tracking, quantity);
}

/** A level-ish value from user input, or null when the part can't take it. */
export function parseLevel(tracking: Tracking, raw: unknown): number | null {
  const text = String(raw ?? "").trim().toLowerCase();
  const choice = levelChoices(tracking).find(
    (c) => String(c.value) === text || c.label.toLowerCase() === text,
  );
  return choice?.value ?? null;
}

/**
 * A part's stock across its locations: the sum of the counts for exact parts;
 * the best level anywhere for level/binary ones (one full bin means it's on
 * hand); always 0 for untracked parts. Mirrored in SQL by totalStock
 * (src/lib/part-queries.ts).
 */
export function totalStock(tracking: Tracking, quantities: number[]): number {
  if (tracking === "exact") return quantities.reduce((sum, q) => sum + q, 0);
  if (tracking === "none") return 0;
  return Math.max(0, ...quantities);
}

/**
 * Converts one stored stock value when a part changes tracking mode. A count
 * becomes a level (below the minimum → low); a level only says there is
 * *some*, so going back to exact starts at 0 — the bins have to be counted.
 * Untracked parts hold 0 and keep nothing to carry over.
 */
export function convertStock(
  from: Tracking,
  to: Tracking,
  quantity: number,
  minStock: number | null,
): number {
  if (from === to) return quantity;
  if (to === "exact" || to === "none" || from === "none") return 0;
  if (from === "exact") {
    if (quantity === 0) return STOCK_LEVELS.empty;
    if (to === "level" && minStock !== null && quantity < minStock) return STOCK_LEVELS.low;
    return STOCK_LEVELS.plenty;
  }
  // level ↔ binary: binary has no "low", so a low bin still counts as stocked.
  return quantity > STOCK_LEVELS.empty ? STOCK_LEVELS.plenty : STOCK_LEVELS.empty;
}

// A null locationId is the part's unsorted pile (see the stock table).
// Pickers and form state, which use null for "nothing chosen", call it
// UNSORTED_VALUE instead and convert at the edges.
export const UNSORTED_VALUE = "__unsorted__";

/** A stock location id as a picker value. */
export function toPickerValue(locationId: string | null): string {
  return locationId ?? UNSORTED_VALUE;
}

/** A picked value as a stock location id: null for unsorted. */
export function fromPickerValue(value: string): string | null {
  return value === UNSORTED_VALUE ? null : value;
}

export type StockSlot = { locationId: string | null; quantity: number };
export type Allocation = { locationId: string | null; quantity: number };

/**
 * Picks the locations to take `needed` from. Draws the smallest stocks first,
 * so a build empties nearly-empty bins instead of nibbling at every bin —
 * fewer half-full bins and fewer places to restock. Unsorted stock counts like
 * any bin (it sorts first on a tie). Null when the slots don't hold enough in
 * total.
 */
export function planConsumption(slots: StockSlot[], needed: number): Allocation[] | null {
  if (needed <= 0) return [];
  const available = slots.filter((s) => s.quantity > 0);
  const total = available.reduce((sum, s) => sum + s.quantity, 0);
  if (total < needed) return null;
  const ordered = [...available].sort(
    (a, b) => a.quantity - b.quantity || (a.locationId ?? "").localeCompare(b.locationId ?? ""),
  );
  const out: Allocation[] = [];
  let remaining = needed;
  for (const slot of ordered) {
    if (remaining === 0) break;
    const take = Math.min(slot.quantity, remaining);
    out.push({ locationId: slot.locationId, quantity: take });
    remaining -= take;
  }
  return out;
}

// `inStock` is the part's total (see totalStock); `tracking` defaults to exact.
export type BomLine = { partId: string; perUnit: number; inStock: number; tracking?: Tracking };

/**
 * Only exact counts are taken out of stock by a build. Level and binary parts
 * aren't counted, so a build can't know what it left behind — their level is
 * updated by hand when a bin runs low.
 */
export function deductsOnBuild(tracking: Tracking = "exact"): boolean {
  return tracking === "exact";
}

/**
 * How many of a line's part a build can use: the count for exact parts; for
 * level/binary parts unlimited unless they're empty; untracked parts never
 * limit a build.
 */
export function availableForBuild(line: BomLine): number {
  const tracking = line.tracking ?? "exact";
  if (tracking === "exact") return line.inStock;
  if (tracking === "none") return Infinity;
  return line.inStock > STOCK_LEVELS.empty ? Infinity : 0;
}

/**
 * How many complete units the stock covers: the scarcest line decides. An
 * empty BOM has nothing to build, so it reports 0 rather than infinity; null
 * means no line is counted (all level/untracked and none empty), so stock
 * sets no limit.
 */
export function buildableUnits(lines: BomLine[]): number | null {
  if (lines.length === 0) return 0;
  const units = Math.min(...lines.map((l) => Math.floor(availableForBuild(l) / l.perUnit)));
  return Number.isFinite(units) ? units : null;
}

export type LineRequirement = BomLine & { required: number; shortfall: number };

export function requirements(lines: BomLine[], units: number): LineRequirement[] {
  return lines.map((l) => {
    const required = l.perUnit * units;
    return { ...l, required, shortfall: Math.max(0, required - availableForBuild(l)) };
  });
}

/** Parses a positive whole-number quantity from form input. */
export function parseQuantity(raw: unknown, { allowZero = false } = {}): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n > 1_000_000_000) return null;
  if (n === 0 && !allowZero) return null;
  return n;
}

/**
 * Needs restocking. Exact parts: below their minimum — reaching it exactly is
 * fine, it is the amount to keep on hand — and parts without a minimum never
 * alert. Level/binary parts: nowhere better than low, i.e. no location is
 * plenty / in stock. Untracked parts never alert. Mirrored in SQL by
 * lowStockFilter (src/lib/part-queries.ts).
 */
export function isLowStock(
  total: number,
  minStock: number | null,
  tracking: Tracking = "exact",
): boolean {
  if (tracking === "exact") return minStock !== null && total < minStock;
  if (tracking === "none") return false;
  return total < STOCK_LEVELS.plenty;
}
