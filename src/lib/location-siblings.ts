import type { FlatLocation } from "@/lib/location-tree";

// Labels already used under `parentId`, per type id — what the add dialog
// needs to suggest the next free label and flag duplicates.
export function siblingLabelsByType(
  locations: FlatLocation[],
  parentId: string | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const l of locations) {
    if (l.parentId !== parentId) continue;
    (out[l.type.id] ??= []).push(l.label);
  }
  return out;
}
