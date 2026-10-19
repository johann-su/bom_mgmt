// Matches imported BOM rows to existing parts. An MPN identifies a part
// exactly, so it wins; only rows without one fall back to the name. Both
// comparisons ignore case and surrounding whitespace. A row whose MPN is
// unknown is *not* matched by name — "10k resistor" with a different MPN is a
// different part, and silently substituting it would be worse than asking.

export type MatchablePart = { id: string; name: string; mpn: string };

export function matchPart(
  row: { name: string; mpn: string },
  parts: MatchablePart[],
): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  if (row.mpn.trim()) {
    return parts.find((p) => p.mpn && norm(p.mpn) === norm(row.mpn))?.id ?? null;
  }
  const byName = parts.filter((p) => norm(p.name) === norm(row.name));
  // Two parts with the same name are ambiguous; let the user pick.
  return byName.length === 1 ? byName[0].id : null;
}
