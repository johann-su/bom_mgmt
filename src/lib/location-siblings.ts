import { sortSiblings, type FlatLocation } from "@/lib/location-tree";

// Labels already used under `parentId`, across all types — what the add
// dialog needs to suggest the next free label and flag duplicates. Siblings
// share one label namespace so a location's code (A/2/IX) stays unique.
export function siblingLabels(locations: FlatLocation[], parentId: string | null): string[] {
  return locations.filter((l) => l.parentId === parentId).map((l) => l.label);
}

export type SiblingCycle<T> = { prev: T; next: T; index: number; total: number };

/**
 * Where a location sits among its siblings of the same type — "Bin 3 of 12
 * in this box" — in tree order, with prev/next wrapping around so the
 * detail page can cycle through one level. Other types under the same
 * parent (a divider among bins) are skipped. Null when it has no such
 * siblings, since there's nothing to cycle through.
 */
export function siblingCycle<T extends FlatLocation>(locations: T[], id: string): SiblingCycle<T> | null {
  const self = locations.find((l) => l.id === id);
  if (!self) return null;
  const ring = sortSiblings(
    locations.filter((l) => l.parentId === self.parentId && l.type.id === self.type.id),
  );
  if (ring.length < 2) return null;
  const index = ring.findIndex((l) => l.id === id);
  return {
    prev: ring[(index - 1 + ring.length) % ring.length],
    next: ring[(index + 1) % ring.length],
    index,
    total: ring.length,
  };
}
