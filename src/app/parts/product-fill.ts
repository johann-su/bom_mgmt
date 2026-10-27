// What "Fill from link" does with a shop's product data beyond plain text
// fields: suggest a category, add specs as attributes, and offer the
// datasheet/photo as files. Pure, so it's unit-tested without React.

import type { PartAttribute } from "@/lib/part-attributes";
import type { ProductInfo } from "@/lib/product-page";

// Shared with the generic-part bulk create; re-exported for the form.
export { suggestCategory, type CategorySuggestion } from "@/lib/category-suggest";

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
