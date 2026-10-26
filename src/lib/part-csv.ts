// Parts CSV import: the pure core behind /parts/import. Reads any spreadsheet
// or distributor order export (DigiKey, Mouser, LCSC, InvenTree, …), guesses
// which column holds which field from its header, and plans per row whether
// it creates a part or updates an existing one, plus optional stock to book.
// The server action (src/app/parts/import/actions.ts) applies the plan.

import { parseCsv } from "@/lib/csv";
import { parseOrderUrl } from "@/lib/part-input";

export const PART_CSV_FIELDS = [
  "name",
  "mpn",
  "manufacturer",
  "description",
  "category",
  "unit",
  "minStock",
  "orderUrl",
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
  orderUrl: "Order link",
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
  orderUrl: ["order link", "order url", "product url", "product link", "url", "link"],
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
  { field: "orderUrl", header: "Order link", help: "http(s) URL of the product page.", examples: ["https://www.digikey.com/", ""] },
  { field: "notes", header: "Notes", help: "Text.", examples: ["", ""] },
  { field: "location", header: "Location", help: "Code of an existing location (e.g. A/1) or its full path. Needed to book stock.", examples: ["A/1", "B"] },
  { field: "quantity", header: "Quantity", help: "Whole number of pieces at that location. Needs a Location.", examples: [10, 200] },
];

/** Column index per field; unmapped fields are absent. */
export type PartCsvMapping = Partial<Record<PartCsvField, number>>;

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Guesses the mapping from a header row. Each field takes the first alias any
 * header matches, and a column is used for one field only.
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
  orderUrl?: string;
  notes?: string;
};

export type PlannedPartRow = {
  line: number; // 1-based line in the file
  values: PartCsvValues;
  // An existing part, or the index of the first row in this file that
  // creates the part (so later rows with the same MPN update that one).
  target: { existing: string } | { created: number };
  stock: { locationId: string; quantity: number } | null;
};

export type PartImportPlan = {
  rows: PlannedPartRow[];
  errors: { line: number; message: string }[];
};

export type KnownPart = { id: string; name: string; mpn: string };
export type KnownLocation = { id: string; code: string; path: string };

const norm = (s: string) => s.trim().toLowerCase();

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
    const orderUrl = cell("orderUrl");
    if (orderUrl) {
      const url = parseOrderUrl(orderUrl);
      if (!url) return fail(`Order link "${orderUrl}" is not an http(s) URL`);
      values.orderUrl = url;
    }

    let stock: PlannedPartRow["stock"] = null;
    const location = cell("location");
    const rawQuantity = cell("quantity");
    if (location) {
      const locationId = locationByKey.get(norm(location));
      if (!locationId) return fail(`Location "${location}" not found`);
      // Spreadsheets love "1,000" and "25.0".
      const cleaned = rawQuantity.replace(/[\s,']/g, "").replace(/\.0+$/, "");
      if (cleaned && !/^\d+$/.test(cleaned)) return fail(`Quantity "${rawQuantity}" is not a whole number`);
      stock = { locationId, quantity: cleaned ? Number(cleaned) : 0 };
    }
    // A quantity without a location has nowhere to go; it's typically an
    // order export's "Qty" — fine to ignore when no location is mapped.
    else if (rawQuantity && mapping.location !== undefined) {
      return fail("Quantity given without a location");
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
