// Matches a suggested category path (a shop's breadcrumb, a generic part's
// ["Fasteners", "Screws"]) against the user's categories. Pure.

export type CategorySuggestion = { id: string } | { name: string };

// "Resistors" and "resistor" are the same category for matching.
const norm = (s: string) => s.trim().toLowerCase().replace(/s$/, "");

/**
 * An existing category if one matches any level of the shop's path — the most
 * specific level wins, so a user who filed LCSC's "Chip Resistor - Surface
 * Mount" under their own "Resistor" gets that again via the parent
 * "Resistors". Otherwise the leaf's name, for the user to accept or shorten.
 */
export function suggestCategory(
  path: string[],
  categories: { id: string; name: string }[],
): CategorySuggestion | null {
  for (const segment of [...path].reverse()) {
    const match = categories.find((c) => norm(c.name) === norm(segment));
    if (match) return { id: match.id };
  }
  const leaf = path.at(-1)?.trim();
  return leaf ? { name: leaf } : null;
}
