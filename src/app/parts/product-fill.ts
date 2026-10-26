// What "Fill from link" does with a shop's product data beyond plain text
// fields: suggest a category, add specs as attributes, and offer the
// datasheet/photo as files. Pure, so it's unit-tested without React.

import type { PartAttribute } from "@/lib/part-attributes";
import type { ProductInfo } from "@/lib/product-page";

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

/**
 * Adds the shop's specs to the attribute rows like the text fields are
 * filled: what the user entered stays (a key they set keeps its value), new
 * keys append, and blank placeholder rows are dropped.
 */
export function fillAttributes(current: PartAttribute[], shop: PartAttribute[]): PartAttribute[] {
  const kept = current.filter((a) => a.key.trim() || a.value.trim());
  const taken = new Set(kept.map((a) => a.key.trim().toLowerCase()));
  const added = shop.filter((a) => !taken.has(a.key.toLowerCase()));
  return [...kept, ...added];
}

export type ShopFile = { url: string; name: string; label: string };

/**
 * The shop's files worth attaching, named after the part. The photo goes
 * first: the first image becomes the part's thumbnail.
 */
export function shopFiles(product: ProductInfo, partName: string): ShopFile[] {
  const base = partName.trim() || product.mpn || product.name || "part";
  const out: ShopFile[] = [];
  if (product.image) out.push({ url: product.image, name: base, label: "Product photo" });
  if (product.datasheet) out.push({ url: product.datasheet, name: `${base} datasheet`, label: "Datasheet" });
  return out;
}
