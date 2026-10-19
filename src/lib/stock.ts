// Pure stock arithmetic: BOM availability and which bins a build draws from.
// The actions in src/app/parts/actions.ts and src/app/boms/actions.ts apply
// the results inside a transaction.

export const MOVEMENT_KINDS = ["add", "remove", "move", "adjust", "build"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export type StockSlot = { locationId: string; quantity: number };
export type Allocation = { locationId: string; quantity: number };

/**
 * Picks the locations to take `needed` from. Draws the smallest stocks first,
 * so a build empties nearly-empty bins instead of nibbling at every bin —
 * fewer half-full bins and fewer places to restock. Null when the slots don't
 * hold enough in total.
 */
export function planConsumption(slots: StockSlot[], needed: number): Allocation[] | null {
  if (needed <= 0) return [];
  const available = slots.filter((s) => s.quantity > 0);
  const total = available.reduce((sum, s) => sum + s.quantity, 0);
  if (total < needed) return null;
  const ordered = [...available].sort(
    (a, b) => a.quantity - b.quantity || a.locationId.localeCompare(b.locationId),
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

export type BomLine = { partId: string; perUnit: number; inStock: number };

/**
 * How many complete units the stock covers: the scarcest line decides. An
 * empty BOM has nothing to build, so it reports 0 rather than infinity.
 */
export function buildableUnits(lines: BomLine[]): number {
  if (lines.length === 0) return 0;
  return Math.min(...lines.map((l) => Math.floor(l.inStock / l.perUnit)));
}

export type LineRequirement = BomLine & { required: number; shortfall: number };

export function requirements(lines: BomLine[], units: number): LineRequirement[] {
  return lines.map((l) => {
    const required = l.perUnit * units;
    return { ...l, required, shortfall: Math.max(0, required - l.inStock) };
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
 * Below the part's minimum stock. Reaching the minimum exactly is fine — it
 * is the amount to keep on hand — and parts without a minimum never alert.
 */
export function isLowStock(total: number, minStock: number | null): boolean {
  return minStock !== null && total < minStock;
}
