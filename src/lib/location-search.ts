import type { LocationOption } from "@/lib/location-tree";

// Matches locations against a search query. A query that looks like a code
// ("A/1", "a1iv", "A-1-IV") matches by code with separators ignored, so the
// way a label sticker is read aloud finds the bin; otherwise the name and the
// readable path are searched.
export function matchLocations(locations: LocationOption[], query: string): LocationOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Anything but letters and digits counts as a separator, whichever one
  // this instance uses (or none — "A1" is already compact).
  const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const qCompact = compact(q);
  const exact: LocationOption[] = [];
  const partial: LocationOption[] = [];
  for (const l of locations) {
    const code = compact(l.code);
    if (code === qCompact) exact.push(l);
    else if (
      (qCompact && code.startsWith(qCompact)) ||
      l.name.toLowerCase().includes(q) ||
      l.path.toLowerCase().includes(q)
    ) {
      partial.push(l);
    }
  }
  return [...exact, ...partial];
}
