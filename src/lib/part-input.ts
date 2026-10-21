import { normalizeAttributes, type PartAttribute } from "@/lib/part-attributes";

export type PartInput = {
  name: string;
  description: string;
  categoryId: string | null;
  manufacturer: string;
  mpn: string;
  unit: string;
  minStock: number | null;
  orderUrl: string;
  attributes: PartAttribute[];
  notes: string;
};

/**
 * Validates and normalizes the part form's raw values. Pure, so the server
 * action and its unit test share one definition of "a valid part".
 */
export function parsePartInput(raw: Record<string, unknown>): PartInput | { error: string } {
  const text = (key: string, max = 2000) => String(raw[key] ?? "").trim().slice(0, max);

  const name = text("name", 200);
  if (!name) return { error: "Name is required" };

  const rawMin = text("minStock");
  let minStock: number | null = null;
  if (rawMin !== "") {
    if (!/^\d+$/.test(rawMin)) return { error: "Minimum stock must be a whole number" };
    minStock = Number(rawMin);
  }

  const orderUrl = parseOrderUrl(text("orderUrl"));
  if (orderUrl === null) return { error: "Order link must be an http(s) URL" };

  const categoryId = text("categoryId");
  return {
    name,
    description: text("description", 20000),
    categoryId: categoryId && categoryId !== "none" ? categoryId : null,
    manufacturer: text("manufacturer", 200),
    mpn: text("mpn", 200),
    // Blank unit means the default; units are short labels, not prose.
    unit: text("unit", 20) || "pcs",
    minStock,
    orderUrl,
    attributes: normalizeAttributes(raw.attributes),
    notes: text("notes", 10000),
  };
}

/**
 * Normalizes an order link: blank stays "" (no link), a bare host like
 * "lcsc.com/product/C123" gets https://, and anything that isn't http(s) is
 * null (rejected) — the URL ends up in an href, so `javascript:` must not pass.
 */
export function parseOrderUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url.href.slice(0, 2000);
}
