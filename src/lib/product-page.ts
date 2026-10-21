// Extracts product data from a shop's product page, for "fill from order
// link". Most shops embed schema.org Product data as JSON-LD for search
// engines (<script type="application/ld+json">); that's the primary source.
// OpenGraph/<meta> tags fill what JSON-LD leaves out, which is often all a
// small shop has. Shopify shops (common for small manufacturers) only put
// tag-stripped text in JSON-LD, so their /products/<handle>.json is merged in
// for the real HTML description. Descriptions come out as Markdown
// (src/lib/markdown.ts). Pure: the fetching lives in src/lib/product-fetch.ts.

import { htmlToMarkdown, looksLikeHtml } from "@/lib/markdown";

export type ProductInfo = {
  name: string;
  description: string; // Markdown
  manufacturer: string;
  mpn: string;
  sku: string;
  gtin: string;
  image: string; // absolute URL, or ""
  price: { amount: string; currency: string } | null;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Node = { [key: string]: Json };

const PRODUCT_TYPES = new Set(["product", "productmodel", "individualproduct"]);

/** Null when the page carries no recognisable product data at all. */
export function extractProductInfo(html: string, pageUrl: string): ProductInfo | null {
  const node = findProductNode(html);
  const meta = readMeta(html);
  const info: ProductInfo = {
    name: text(node?.name) || meta["og:title"] || "",
    description: richText(node?.description) || meta["og:description"] || meta.description || "",
    manufacturer: nameOf(node?.manufacturer) || nameOf(node?.brand) || meta["product:brand"] || "",
    mpn: text(node?.mpn),
    sku: text(node?.sku) || meta["product:retailer_item_id"] || "",
    gtin: ["gtin", "gtin13", "gtin12", "gtin14", "gtin8"].map((k) => text(node?.[k])).find(Boolean) ?? "",
    image: absoluteUrl(imageOf(node?.image) || meta["og:image"] || "", pageUrl),
    price: priceOf(node?.offers) ?? metaPrice(meta),
  };
  // Without JSON-LD, og:title alone is just a page title — only count it as a
  // product when the page says it is one.
  if (!node && meta["og:type"]?.toLowerCase() !== "product" && !meta["product:brand"]) return null;
  return info.name || info.mpn ? info : null;
}

// --- JSON-LD ----------------------------------------------------------------

function findProductNode(html: string): Node | null {
  const scripts = html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, body] of scripts) {
    const data = parseJsonLd(body);
    const found = data === undefined ? null : walk(data, 0);
    if (found) return found;
  }
  return null;
}

// Undefined when unparseable — one broken block shouldn't hide the next.
// Hand-templated JSON-LD often has raw newlines inside strings, which
// JSON.parse rejects; flattening control characters fixes those.
function parseJsonLd(body: string): Json | undefined {
  const stripped = body.replace(/^\s*(<!--|<!\[CDATA\[)|(-->|\]\]>)\s*$/g, "").trim();
  for (const candidate of [stripped, stripped.replace(/[\u0000-\u001f]+/g, " ")]) {
    try {
      return JSON.parse(candidate) as Json;
    } catch {}
  }
  return undefined;
}

// Depth-first search: products hide in @graph, in arrays, or under a
// WebPage's mainEntity/ItemPage's about. A ProductGroup's first variant counts.
function walk(value: Json, depth: number): Node | null {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walk(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const types = [value["@type"]].flat().map((t) => String(t).toLowerCase());
  if (types.some((t) => PRODUCT_TYPES.has(t))) return value;
  for (const child of Object.values(value)) {
    const found = walk(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function text(value: Json | undefined): string {
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value !== "string") return "";
  return clean(value);
}

// Descriptions keep their structure: markup (sometimes entity-escaped, as in
// "&lt;p&gt;") becomes Markdown; plain text keeps its line breaks.
function richText(value: Json | undefined): string {
  if (Array.isArray(value)) return richText(value[0]);
  if (typeof value !== "string") return "";
  const decoded = decodeEntities(decodeEntities(value));
  if (looksLikeHtml(decoded)) return htmlToMarkdown(decoded);
  return decoded
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// brand/manufacturer: "Acme", { "@type": "Brand", "name": "Acme" }, or a list.
function nameOf(value: Json | undefined): string {
  if (Array.isArray(value)) return nameOf(value[0]);
  if (value && typeof value === "object") return text(value.name);
  return text(value);
}

function imageOf(value: Json | undefined): string {
  if (Array.isArray(value)) return imageOf(value[0]);
  if (value && typeof value === "object") return text(value.contentUrl) || text(value.url);
  return text(value);
}

function priceOf(value: Json | undefined): ProductInfo["price"] {
  if (Array.isArray(value)) return priceOf(value[0]);
  if (!value || typeof value !== "object") return null;
  const spec = Array.isArray(value.priceSpecification) ? value.priceSpecification[0] : value.priceSpecification;
  const specNode = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : null;
  const amount = text(value.price) || text(value.lowPrice) || text(specNode?.price);
  if (!amount) return null;
  return { amount, currency: text(value.priceCurrency) || text(specNode?.priceCurrency) };
}

// --- <meta> -------------------------------------------------------------------

// og:*, product:* and the plain description, by lower-cased property/name.
function readMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(tag, "property") || attr(tag, "name");
    const content = attr(tag, "content");
    if (!key || !content) continue;
    const k = key.toLowerCase();
    if (!(k in out)) out[k] = clean(content);
  }
  return out;
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

function metaPrice(meta: Record<string, string>): ProductInfo["price"] {
  const amount = meta["product:price:amount"] || meta["og:price:amount"];
  if (!amount) return null;
  return { amount, currency: meta["product:price:currency"] || meta["og:price:currency"] || "" };
}

// --- strings ------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  micro: "µ",
  deg: "°",
  plusmn: "±",
  times: "×",
  ohm: "Ω",
  reg: "®",
  trade: "™",
  copy: "©",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Decodes HTML entities (twice — shops double-escape), drops tags, collapses whitespace. */
export function clean(value: string): string {
  return decodeEntities(decodeEntities(value))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string, base: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

// --- Shopify --------------------------------------------------------------------

/**
 * The product JSON URL for a Shopify product page, or null when the page
 * isn't one. Shopify serves /products/<handle>.json on every storefront,
 * also under collection paths (/collections/x/products/<handle>).
 */
export function shopifyProductJsonUrl(html: string, pageUrl: string): string | null {
  if (!/cdn\.shopify\.com|Shopify\.shop\s*=/.test(html)) return null;
  const url = new URL(pageUrl);
  const handle = url.pathname.match(/\/products\/([^/.?#]+)/)?.[1];
  return handle ? `${url.origin}/products/${handle}.json` : null;
}

type ShopifyProduct = {
  title?: unknown;
  body_html?: unknown;
  vendor?: unknown;
  variants?: { id?: unknown; sku?: unknown; barcode?: unknown }[];
};

/**
 * Merges a Shopify product JSON into what the page itself gave: the HTML
 * description wins (JSON-LD only has it tag-stripped, words glued together);
 * vendor, SKU and barcode fill gaps. The variant comes from ?variant= in the
 * page URL, else the product's only variant.
 */
export function mergeShopifyProduct(info: ProductInfo | null, json: unknown, pageUrl: string): ProductInfo | null {
  const product = (json as { product?: ShopifyProduct } | null)?.product;
  if (!product || typeof product !== "object") return info;
  const str = (v: unknown) => (typeof v === "string" ? clean(v) : "");
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variantId = new URL(pageUrl).searchParams.get("variant");
  const variant =
    variants.find((v) => variantId && String(v.id) === variantId) ?? (variants.length === 1 ? variants[0] : undefined);
  const description = typeof product.body_html === "string" ? htmlToMarkdown(product.body_html) : "";
  const base: ProductInfo = info ?? {
    name: "",
    description: "",
    manufacturer: "",
    mpn: "",
    sku: "",
    gtin: "",
    image: "",
    price: null,
  };
  const merged: ProductInfo = {
    ...base,
    name: base.name || str(product.title),
    description: description || base.description,
    manufacturer: base.manufacturer || str(product.vendor),
    sku: base.sku || str(variant?.sku),
    gtin: base.gtin || str(variant?.barcode),
  };
  return merged.name || merged.mpn ? merged : null;
}
