// Parts CSV import: the pure core behind /parts/import. Reads any spreadsheet
// or distributor order export (DigiKey, Mouser, LCSC, InvenTree, …), guesses
// which column holds which field from its header, and plans per row whether
// it creates a part or updates an existing one, plus optional stock to book.
// src/lib/part-import.ts applies the plan (for the page and the MCP tool).

import { parseCsv } from "@/lib/csv";
import { normalizeAttributes, type PartAttribute } from "@/lib/part-attributes";
import { parseOrderUrls } from "@/lib/part-input";

export const PART_CSV_FIELDS = [
  "name",
  "mpn",
  "manufacturer",
  "description",
  "category",
  "unit",
  "minStock",
  "orderUrls",
  "notes",
  "location",
  "quantity",
] as const;
export type PartCsvField = (typeof PART_CSV_FIELDS)[number];

export const PART_CSV_FIELD_LABELS: Record<PartCsvField, string> = {
  name: "Name",
  mpn: "MPN",
  manufacturer: "Manufacturer",
  description: "Description",
  category: "Category",
  unit: "Unit",
  minStock: "Min. stock",
  orderUrls: "Order links",
  notes: "Notes",
  location: "Location (code)",
  quantity: "Quantity",
};

// Header spellings per field, most specific first. Distributor exports have a
// "Part Number" column holding *their* SKU next to the manufacturer's one, so
// the long manufacturer spellings must win over the bare "part number".
const HEADER_ALIASES: Record<PartCsvField, string[]> = {
  name: ["name", "part name", "part", "title", "item", "component"],
  mpn: [
    "mpn",
    "manufacturer part number",
    "manufacture part number", // LCSC's spelling
    "mfr part number",
    "mfr. part number",
    "mfr. #",
    "mfr #",
    "mfr. part #",
    "mfr part #",
    "manufacturer part no",
    "part number",
    "pn",
  ],
  manufacturer: ["manufacturer", "manufacturer name", "mfr", "mfr.", "brand"],
  description: ["description", "desc", "details"],
  category: ["category", "categories", "group"],
  unit: ["unit", "units", "uom"],
  minStock: ["min stock", "min. stock", "minimum stock", "min qty", "reorder point", "reorder level"],
  orderUrls: ["order links", "order link", "order urls", "order url", "product url", "product link", "url", "link"],
  notes: ["notes", "note", "remarks", "comment", "comments"],
  location: ["location", "storage location", "storage", "bin", "loc"],
  quantity: ["quantity", "qty", "qty.", "order qty.", "order qty", "in stock", "stock", "on hand", "count"],
};

/**
 * The importer's native layout: the header each field is recognized by, what
 * goes in it, and an example. Feeds the format guide on /parts/import and the
 * downloadable template, so both always match what guessPartMapping reads.
 */
export const PART_CSV_TEMPLATE: { field: PartCsvField; header: string; help: string; examples: [string | number, string | number] }[] = [
  { field: "name", header: "Name", help: "Part name. Required unless an MPN is given.", examples: ["NE555 timer", "M3x8 screw"] },
  { field: "mpn", header: "MPN", help: "Manufacturer part number. Identifies the part: a row with a known MPN updates that part.", examples: ["NE555P", ""] },
  { field: "manufacturer", header: "Manufacturer", help: "Text.", examples: ["Texas Instruments", ""] },
  { field: "description", header: "Description", help: "Text.", examples: ["Single precision timer, DIP-8", "ISO 4762, stainless"] },
  { field: "category", header: "Category", help: "Category name; created if it doesn't exist yet.", examples: ["ICs", "Fasteners"] },
  { field: "unit", header: "Unit", help: "Unit of count, e.g. pcs or m.", examples: ["pcs", "pcs"] },
  { field: "minStock", header: "Min stock", help: "Whole number; warns when stock falls below it.", examples: [5, 50] },
  { field: "orderUrls", header: "Order links", help: "http(s) URL of the product page; several (one per supplier) separated by spaces, line breaks or \";\". Added to a part's existing links.", examples: ["https://www.digikey.com/", ""] },
  { field: "notes", header: "Notes", help: "Text.", examples: ["", ""] },
  { field: "location", header: "Location", help: "Code of an existing location (e.g. A/1) or its full path. Empty (or \"unsorted\") books the quantity as unsorted.", examples: ["A/1", "B"] },
  { field: "quantity", header: "Quantity", help: "Whole number of pieces at that location, or unsorted when there is none.", examples: [10, 200] },
];

/** An attribute column for the template and format guide; any number may follow. */
export const PART_CSV_ATTRIBUTE_EXAMPLE = {
  header: "Attr: Package",
  help: "Any column can become an attribute, named after its header. Columns starting with \"Attr:\" are picked automatically.",
  examples: ["DIP-8", ""] as [string, string],
};

/**
 * Column index per field; unmapped fields are absent. `attributes` lists the
 * columns imported as attributes, keyed by their header.
 */
export type PartCsvMapping = Partial<Record<PartCsvField, number>> & { attributes?: number[] };

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

const ATTRIBUTE_HEADER = /^attr(?:ibute)?\s*[:.]\s*(\S.*)$/i;

/** The attribute key a column yields: its header, minus an "Attr:" prefix. */
export function attributeKey(header: string): string {
  const trimmed = header.trim();
  return ATTRIBUTE_HEADER.exec(trimmed)?.[1].trim() ?? trimmed;
}

/**
 * Guesses the mapping from a header row. Each field takes the first alias any
 * header matches, and a column is used for one field only. Only "Attr: …"
 * columns become attributes on their own — order exports carry plenty of
 * columns (prices, line numbers) that shouldn't end up on a part.
 */
export function guessPartMapping(headers: string[]): PartCsvMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: PartCsvMapping = {};
  const used = new Set<number>();
  for (const field of PART_CSV_FIELDS) {
    for (const alias of HEADER_ALIASES[field]) {
      const index = normalized.findIndex((h, i) => h === alias && !used.has(i));
      if (index !== -1) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  const attributes = headers.flatMap((h, i) => (!used.has(i) && ATTRIBUTE_HEADER.test(h.trim()) ? [i] : []));
  if (attributes.length) mapping.attributes = attributes;
  return mapping;
}

export type PartCsvTable = { headers: string[]; rows: string[][] };

/** Splits parsed rows (from a CSV or an .xlsx sheet) into header and data rows. */
export function partTableFromRows([headers = [], ...rows]: string[][]): PartCsvTable {
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Splits CSV text into its header row and data rows. */
export function readPartCsv(text: string): PartCsvTable {
  return partTableFromRows(parseCsv(text));
}

/**
 * Validates rows sent by the client: an array of string arrays within the
 * size limits, or null. The browser parses the file (CSV or .xlsx) so the
 * server never unzips user uploads.
 */
export function sanitizeRows(raw: unknown, { maxRows = 50_000, maxChars = 5_000_000 } = {}): string[][] | null {
  if (!Array.isArray(raw) || raw.length > maxRows) return null;
  let chars = 0;
  for (const row of raw) {
    if (!Array.isArray(row)) return null;
    for (const cell of row) {
      if (typeof cell !== "string") return null;
      chars += cell.length + 1; // +1 so a flood of empty cells counts too
    }
    if (chars > maxChars) return null;
  }
  return raw as string[][];
}

/**
 * Drops mapping entries that point outside the header row or share a column,
 * so a client-sent mapping can't make the server read garbage.
 */
export function sanitizeMapping(raw: unknown, columnCount: number): PartCsvMapping {
  const mapping: PartCsvMapping = {};
  if (!raw || typeof raw !== "object") return mapping;
  const used = new Set<number>();
  for (const field of PART_CSV_FIELDS) {
    const index = (raw as Record<string, unknown>)[field];
    if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < columnCount && !used.has(index)) {
      mapping[field] = index;
      used.add(index);
    }
  }
  const attributes = (raw as { attributes?: unknown }).attributes;
  if (Array.isArray(attributes)) {
    const valid = attributes.filter((index): index is number => {
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= columnCount) return false;
      if (used.has(index)) return false;
      used.add(index);
      return true;
    });
    if (valid.length) mapping.attributes = valid;
  }
  return mapping;
}

// --- Planning ---------------------------------------------------------------

/** Fields a row sets on its part. Absent = the CSV leaves it alone. */
export type PartCsvValues = {
  name?: string;
  mpn?: string;
  manufacturer?: string;
  description?: string;
  category?: string; // by name; created when missing
  unit?: string;
  minStock?: number;
  orderUrls?: string[]; // added to the part's existing ones
  notes?: string;
  attributes?: PartAttribute[]; // merged into the part's existing ones
};

export type PlannedPartRow = {
  line: number; // 1-based line in the file
  values: PartCsvValues;
  // An existing part, or the index of the first row in this file that
  // creates the part (so later rows with the same MPN update that one).
  target: { existing: string } | { created: number };
  // A null locationId is the part's unsorted pile.
  stock: { locationId: string | null; quantity: number } | null;
};

export type PartImportPlan = {
  rows: PlannedPartRow[];
  errors: { line: number; message: string }[];
};

export type KnownPart = { id: string; name: string; mpn: string };
export type KnownLocation = { id: string; code: string; path: string };

const norm = (s: string) => s.trim().toLowerCase();
const UNSORTED = "unsorted";

/**
 * Plans the import. A row needs a name or an MPN; an empty cell never
 * overwrites existing data, so a sparse CSV (just MPN + quantity) is safe to
 * import over a curated inventory.
 *
 * Matching: an MPN identifies a part. When no part has the row's MPN, a part
 * with the same name and *no* MPN yet is taken — that's the hand-entered part
 * the CSV is now completing. A name-only row matches a unique name. Several
 * rows may name one part (it sits in several bins); the first creates it.
 */
export function planPartImport(
  table: PartCsvTable,
  mapping: PartCsvMapping,
  known: { parts: KnownPart[]; locations: KnownLocation[] },
): PartImportPlan {
  const errors: PartImportPlan["errors"] = [];
  const rows: PlannedPartRow[] = [];
  if (mapping.name === undefined && mapping.mpn === undefined) {
    return { rows, errors: [{ line: 1, message: "Map a Name or MPN column to identify the parts" }] };
  }

  // Parts created earlier in this file, keyed like the existing ones.
  const created: { index: number; name: string; mpn: string }[] = [];
  const locationByKey = new Map<string, string>();
  for (const l of known.locations) {
    locationByKey.set(norm(l.path), l.id);
    locationByKey.set(norm(l.code), l.id); // codes win over a path spelled the same
  }

  table.rows.forEach((cells, i) => {
    const line = i + 2;
    const cell = (field: PartCsvField) => {
      const index = mapping[field];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    const fail = (message: string) => errors.push({ line, message });

    const name = cell("name").slice(0, 200);
    const mpn = cell("mpn").slice(0, 200);
    if (!name && !mpn) return fail("Row has neither a name nor an MPN");

    const values: PartCsvValues = {};
    if (name) values.name = name;
    if (mpn) values.mpn = mpn;
    const texts = [
      ["manufacturer", 200],
      ["description", 20000],
      ["category", 200],
      ["unit", 20],
      ["notes", 10000],
    ] as const;
    for (const [field, max] of texts) {
      const value = cell(field);
      if (value) values[field] = value.slice(0, max);
    }
    const minStock = cell("minStock");
    if (minStock) {
      if (!/^\d+$/.test(minStock)) return fail(`Min. stock "${minStock}" is not a whole number`);
      values.minStock = Number(minStock);
    }
    const attributes = normalizeAttributes(
      (mapping.attributes ?? []).map((index) => ({
        key: attributeKey(table.headers[index] ?? ""),
        value: (cells[index] ?? "").trim(),
      })),
    ).filter((a) => a.value !== "");
    if (attributes.length) values.attributes = attributes;
    const orderUrls = parseOrderUrls(cell("orderUrls"));
    if ("error" in orderUrls) return fail(orderUrls.error);
    if (orderUrls.urls.length) values.orderUrls = orderUrls.urls;

    let stock: PlannedPartRow["stock"] = null;
    const location = cell("location");
    const rawQuantity = cell("quantity");
    // "unsorted" spelled out means the pile — unless a location is called that.
    const unsorted = !location || (norm(location) === UNSORTED && !locationByKey.has(UNSORTED));
    // Spreadsheets love "1,000" and "25.0".
    const cleaned = rawQuantity.replace(/[\s,']/g, "").replace(/\.0+$/, "");
    if (cleaned && !/^\d+$/.test(cleaned)) return fail(`Quantity "${rawQuantity}" is not a whole number`);
    if (!unsorted) {
      const locationId = locationByKey.get(norm(location));
      if (!locationId) return fail(`Location "${location}" not found`);
      stock = { locationId, quantity: cleaned ? Number(cleaned) : 0 };
    }
    // A quantity with no location (an empty cell, or no Location column, as
    // in an order export) is on hand but not put away yet: it goes to the
    // part's unsorted pile.
    else if (cleaned) {
      stock = { locationId: null, quantity: Number(cleaned) };
    }

    const target = resolveTarget(name, mpn, known.parts, created);
    if ("error" in target) return fail(target.error);
    if ("created" in target && target.created === -1) {
      created.push({ index: rows.length, name: name || mpn, mpn });
      rows.push({ line, values, target: { created: rows.length }, stock });
    } else {
      rows.push({ line, values, target, stock });
    }
  });
  return { rows, errors };
}

// `created: -1` = a new part; resolved to its own row index by the caller.
function resolveTarget(
  name: string,
  mpn: string,
  parts: KnownPart[],
  created: { index: number; name: string; mpn: string }[],
): PlannedPartRow["target"] | { error: string } {
  const all = [
    ...parts.map((p) => ({ ...p, ref: { existing: p.id } as PlannedPartRow["target"] })),
    ...created.map((c) => ({ ...c, ref: { created: c.index } as PlannedPartRow["target"] })),
  ];
  if (mpn) {
    const byMpn = all.find((p) => p.mpn && norm(p.mpn) === norm(mpn));
    if (byMpn) return byMpn.ref;
    if (!name) return { created: -1 };
    const unnumbered = all.filter((p) => !p.mpn && norm(p.name) === norm(name));
    return unnumbered.length === 1 ? unnumbered[0].ref : { created: -1 };
  }
  const byName = all.filter((p) => norm(p.name) === norm(name));
  if (byName.length > 1) return { error: `Several parts are named "${name}" — add an MPN column` };
  return byName.length === 1 ? byName[0].ref : { created: -1 };
}

/** Counts for the preview and the result summary. */
export function summarizePlan(plan: PartImportPlan) {
  const updated = new Set(
    plan.rows.flatMap((r) => ("existing" in r.target ? [r.target.existing] : [])),
  );
  return {
    created: plan.rows.filter((r, i) => "created" in r.target && r.target.created === i).length,
    updated: updated.size,
    stock: plan.rows.filter((r) => r.stock && r.stock.quantity > 0).length,
    errors: plan.errors.length,
  };
}
