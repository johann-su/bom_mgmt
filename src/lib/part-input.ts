import { parseGenericSpec, type GenericSpec } from "@/lib/generic-parts";
import { isIconId } from "@/lib/label-icons";
import { normalizeAttributes, type PartAttribute } from "@/lib/part-attributes";
import { isTracking, type Tracking } from "@/lib/stock";

export type PartInput = {
  name: string;
  description: string;
  categoryId: string | null;
  manufacturer: string;
  mpn: string;
  unit: string;
  tracking: Tracking;
  minStock: number | null;
  orderUrls: string[];
  icon: string;
  attributes: PartAttribute[];
  generic: GenericSpec | null;
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

  // Blank means the default, so callers that predate tracking modes keep
  // counting.
  const tracking = text("tracking", 20) || "exact";
  if (!isTracking(tracking)) return { error: `Unknown stock tracking "${tracking}"` };

  const orderUrls = parseOrderUrls(raw.orderUrls);
  if ("error" in orderUrls) return orderUrls;

  // Not a user-typed field (the form's picker sets it), so a malformed id is
  // dropped rather than reported.
  const icon = text("icon", 200);

  const categoryId = text("categoryId");
  return {
    name,
    description: text("description", 20000),
    categoryId: categoryId && categoryId !== "none" ? categoryId : null,
    manufacturer: text("manufacturer", 200),
    mpn: text("mpn", 200),
    // Blank unit means the default; units are short labels, not prose.
    unit: text("unit", 20) || "pcs",
    tracking,
    minStock,
    orderUrls: orderUrls.urls,
    icon: isIconId(icon) ? icon : "",
    attributes: normalizeAttributes(raw.attributes),
    // Like the icon, set by the wizard, not typed: a malformed one is dropped.
    generic: parseGenericSpec(raw.generic),
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

/** Most supplier links a part keeps. */
export const MAX_ORDER_URLS = 20;

/**
 * Normalizes a part's supplier links: a list (form, MCP) or one string with
 * links separated by whitespace or ";" (a spreadsheet cell). Blanks are
 * skipped, duplicates dropped keeping the first (order = preference), and any
 * link parseOrderUrl rejects fails the whole list.
 */
export function parseOrderUrls(raw: unknown): { urls: string[] } | { error: string } {
  const items =
    raw === undefined || raw === null
      ? []
      : Array.isArray(raw)
        ? raw.map((item) => String(item ?? ""))
        : splitOrderUrls(String(raw));
  const urls: string[] = [];
  for (const item of items) {
    const url = parseOrderUrl(item);
    if (url === null) return { error: `Order link "${item.trim().slice(0, 100)}" is not an http(s) URL` };
    if (url && !urls.includes(url)) urls.push(url);
  }
  if (urls.length > MAX_ORDER_URLS) return { error: `At most ${MAX_ORDER_URLS} order links per part` };
  return { urls };
}

/**
 * Adds links to a part's existing ones: known links keep their place (the
 * preferred supplier stays first), new ones append, up to MAX_ORDER_URLS.
 */
export function mergeOrderUrls(existing: string[], added: string[]): string[] {
  return [...existing, ...added.filter((url) => !existing.includes(url))].slice(0, MAX_ORDER_URLS);
}

// URLs carry no whitespace and hardly ever a ";", so those separate links.
function splitOrderUrls(raw: string): string[] {
  return raw.split(/[\s;]+/).filter(Boolean);
}

/**
 * The supplier a link points to, for labelling it: the host without "www."
 * ("lcsc.com"), or the link itself if it doesn't parse.
 */
export function supplierName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
