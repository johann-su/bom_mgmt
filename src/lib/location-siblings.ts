import type { FlatLocation } from "@/lib/location-tree";

// Labels already used under `parentId`, across all types — what the add
// dialog needs to suggest the next free label and flag duplicates. Siblings
// share one label namespace so a location's code (A/2/IX) stays unique.
export function siblingLabels(locations: FlatLocation[], parentId: string | null): string[] {
  return locations.filter((l) => l.parentId === parentId).map((l) => l.label);
}
