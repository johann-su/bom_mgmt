// Extracts product data from a shop's product page, for "fill from order
// link". Most shops embed schema.org Product data as JSON-LD for search
// engines (<script type="application/ld+json">); that's the primary source.
// OpenGraph/<meta> tags fill what JSON-LD leaves out, which is often all a
// small shop has. Shopify shops (common for small manufacturers) only put
// tag-stripped text in JSON-LD, so their /products/<handle>.json is merged in
// for the real HTML description. Descriptions come out as Markdown
// (src/lib/markdown.ts). Distributors (LCSC, …) add a category, specs as
// additionalProperty and the datasheet as subjectOf — those become the
// suggested category, attributes and a file to attach. Pure: the fetching
// lives in src/lib/product-fetch.ts.

import { htmlToMarkdown, looksLikeHtml } from "@/lib/markdown";
import { normalizeAttributes, type PartAttribute } from "@/lib/part-attributes";

export type ProductInfo = {
  name: string;
  description: string; // Markdown
  manufacturer: string;
  mpn: string;
  sku: string;
  gtin: string;
  image: string; // absolute URL, or ""
  price: { amount: string; currency: string } | null;
  category: string[]; // the shop's category path, broadest first; [] if unknown
  attributes: PartAttribute[]; // specs ("Package: SOT-23-5")
  datasheet: string; // absolute URL of the datasheet, or ""
};

function emptyInfo(): ProductInfo {
  return {
    name: "",
    description: "",
    manufacturer: "",
    mpn: "",
    sku: "",
    gtin: "",
    image: "",
    price: null,
    category: [],
    attributes: [],
    datasheet: "",
  };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Node = { [key: string]: Json };

const PRODUCT_TYPES = new Set(["product", "productmodel", "individualproduct"]);

/** Null when the page carries no recognisable product data at all. */
export function extractProductInfo(html: string, pageUrl: string): ProductInfo | null {
  const blocks = jsonLdBlocks(html);
  const node = findNode(blocks, PRODUCT_TYPES);
  const meta = readMeta(html);
  const name = text(node?.name) || meta["og:title"] || "";
  const info: ProductInfo = {
    name,
    description: richText(node?.description) || meta["og:description"] || meta.description || "",
    manufacturer: nameOf(node?.manufacturer) || nameOf(node?.brand) || meta["product:brand"] || "",
    mpn: text(node?.mpn),
    sku: text(node?.sku) || meta["product:retailer_item_id"] || "",
    gtin: ["gtin", "gtin13", "gtin12", "gtin14", "gtin8"].map((k) => text(node?.[k])).find(Boolean) ?? "",
    image: absoluteUrl(imageOf(node?.image) || meta["og:image"] || "", pageUrl),
    price: priceOf(node?.offers) ?? metaPrice(meta),
    category: breadcrumbPath(findNode(blocks, BREADCRUMB_TYPES), name, pageUrl) ?? categoryPath(node?.category),
    attributes: attributesOf(node?.additionalProperty),
    datasheet: absoluteUrl(datasheetOf(node?.subjectOf) || datasheetLink(html), pageUrl),
  };
  // Without JSON-LD, og:title alone is just a page title — only count it as a
  // product when the page says it is one.
  if (!node && meta["og:type"]?.toLowerCase() !== "product" && !meta["product:brand"]) return null;
  return info.name || info.mpn ? info : null;
}

// --- JSON-LD ----------------------------------------------------------------

const BREADCRUMB_TYPES = new Set(["breadcrumblist"]);

function jsonLdBlocks(html: string): Json[] {
  const scripts = html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  );
  return [...scripts].map(([, body]) => parseJsonLd(body)).filter((data) => data !== undefined);
}

function findNode(blocks: Json[], types: Set<string>): Node | null {
  for (const data of blocks) {
    const found = walk(data, types, 0);
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
function walk(value: Json, types: Set<string>, depth: number): Node | null {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walk(item, types, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeOf(value).some((t) => types.has(t))) return value;
  for (const child of Object.values(value)) {
    const found = walk(child, types, depth + 1);
    if (found) return found;
  }
  return null;
}

function typeOf(node: Node): string[] {
  return [node["@type"]].flat().map((t) => String(t).toLowerCase());
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

// --- category, specs, datasheet ----------------------------------------------

// Leading crumbs that are site navigation, not a category.
const NAV_CRUMB = /^(home|start|shop|store|products?|all products|startseite|produkte)$/i;

/**
 * The category path from a BreadcrumbList: navigation crumbs at the start and
 * the product itself at the end are dropped. Null when there's no usable
 * breadcrumb, so Product.category gets its turn. Preferred over
 * Product.category because a shop's breadcrumb names the categories it
 * actually browses by.
 */
function breadcrumbPath(list: Node | null, productName: string, pageUrl: string): string[] | null {
  const items = list?.itemListElement;
  if (!Array.isArray(items)) return null;
  const crumbs = items
    .filter((item): item is Node => !!item && typeof item === "object" && !Array.isArray(item))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((item) => ({ name: text(item.name) || nameOf(item.item), url: urlOf(item.item, pageUrl) }));
  while (crumbs.length && (NAV_CRUMB.test(crumbs[0].name) || isSiteRoot(crumbs[0].url))) crumbs.shift();
  const last = crumbs.at(-1);
  if (last && (last.name === productName || (last.url && samePage(last.url, pageUrl)))) crumbs.pop();
  const path = crumbs.map((c) => c.name).filter(Boolean);
  return path.length ? path : null;
}

function urlOf(value: Json | undefined, base: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) return absoluteUrl(text(value["@id"]) || text(value.url), base);
  return absoluteUrl(text(value), base);
}

function isSiteRoot(url: string): boolean {
  return !!url && new URL(url).pathname.replace(/\/+$/, "") === "";
}

function samePage(a: string, b: string): boolean {
  const strip = (u: string) => {
    const url = new URL(u);
    return url.host + url.pathname.replace(/\/+$/, "");
  };
  return strip(a) === strip(b);
}

// Product.category: "A > B > C", "A/B/C" (LCSC), a CategoryCode, or a list.
// Google taxonomy ids and URLs aren't names, so they're skipped.
function categoryPath(value: Json | undefined): string[] {
  if (Array.isArray(value)) return categoryPath(value[0]);
  const raw = value && typeof value === "object" ? text(value.name) : text(value);
  if (!raw || /^\d+$/.test(raw) || /^https?:/i.test(raw)) return [];
  return raw
    .split(/\s*[>›»|/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// additionalProperty: PropertyValue { name, value, unitText }. Placeholders
// for "no value" ("-", "--", "N/A") are dropped.
function attributesOf(value: Json | undefined): PartAttribute[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const attributes: PartAttribute[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const key = text(item.name);
    const unit = text(item.unitText);
    const val = [text(item.value), unit].filter(Boolean).join(" ");
    if (key && val && !/^(-+|n\/?a)$/i.test(val)) attributes.push({ key, value: val });
  }
  return normalizeAttributes(attributes);
}

// subjectOf: a DigitalDocument named "Datasheet" (LCSC), or any linked PDF.
function datasheetOf(value: Json | undefined): string {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const docs = list.filter((d): d is Node => !!d && typeof d === "object" && !Array.isArray(d));
  const url = (d: Node) => text(d.url) || text(d.contentUrl);
  const named = docs.find((d) => /data\s*sheet/i.test(text(d.name)) && url(d));
  const pdf = docs.find((d) => /\.pdf(\?|#|$)/i.test(url(d)) || text(d.encodingFormat) === "application/pdf");
  return named ? url(named) : pdf ? url(pdf) : "";
}

// Fallback for shops without one in JSON-LD: the first <a> to a PDF whose
// link text or URL says "datasheet".
function datasheetLink(html: string): string {
  for (const [, tag, body] of html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = clean(attr(tag, "href"));
    if (!/\.pdf(\?|#|$)/i.test(href)) continue;
    if (/data[\s_-]*sheet/i.test(href) || /data\s*sheet/i.test(clean(body))) return href;
  }
  return "";
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
  const base: ProductInfo = info ?? emptyInfo();
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
