// BOM CSV import/export. Exports are plain RFC 4180 CSV; imports accept what
// spreadsheets and EDA tools (KiCad, Fusion, JLCPCB templates) tend to
// produce: any column order, header names in several spellings, `,` or `;`
// delimiters, and quoted fields with embedded newlines.

import { parseCsv } from "@/lib/csv";

export { parseCsv, toCsv } from "@/lib/csv";

// --- BOM rows -------------------------------------------------------------

export type BomCsvColumn = "name" | "mpn" | "manufacturer" | "quantity" | "reference" | "notes";

const HEADER_ALIASES: Record<BomCsvColumn, string[]> = {
  name: ["name", "part", "part name", "component", "description", "value", "comment", "item"],
  mpn: ["mpn", "part number", "manufacturer part number", "mfr part number", "mfr. part #", "mfr part", "pn"],
  manufacturer: ["manufacturer", "mfr", "mfr.", "brand", "vendor"],
  quantity: ["quantity", "qty", "qty.", "count", "amount", "quantity per pcb"],
  reference: ["reference", "references", "designator", "designators", "ref", "refs", "ref des"],
  notes: ["notes", "note", "remarks"],
};

export type BomCsvRow = {
  line: number; // 1-based line in the file, for error messages
  name: string;
  mpn: string;
  manufacturer: string;
  quantity: number;
  reference: string;
  notes: string;
};

export type BomCsvResult = {
  rows: BomCsvRow[];
  errors: { line: number; message: string }[];
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

// Maps header cells to columns. Each column takes the first header that names
// it, so "Description" only counts as the part name when there's no "Name".
function mapHeaders(headers: string[]): Map<BomCsvColumn, number> {
  const normalized = headers.map(normalizeHeader);
  const map = new Map<BomCsvColumn, number>();
  for (const column of Object.keys(HEADER_ALIASES) as BomCsvColumn[]) {
    for (const alias of HEADER_ALIASES[column]) {
      const index = normalized.indexOf(alias);
      if (index !== -1 && ![...map.values()].includes(index)) {
        map.set(column, index);
        break;
      }
    }
  }
  return map;
}

/**
 * Reads BOM lines from CSV text. A row needs a name or an MPN to identify the
 * part, and a positive whole quantity (missing = 1, the common case for EDA
 * exports that list one row per designator). Rows naming the same part are
 * merged by summing quantities and joining references, since a BOM holds a
 * part once.
 */
export function parseBomCsv(text: string): BomCsvResult {
  const table = parseCsv(text);
  const errors: BomCsvResult["errors"] = [];
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty" }] };

  const columns = mapHeaders(table[0]);
  if (!columns.has("name") && !columns.has("mpn")) {
    return {
      rows: [],
      errors: [{ line: 1, message: "No part column found — add a header named Name, Part or MPN" }],
    };
  }

  const merged = new Map<string, BomCsvRow>();
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const cell = (column: BomCsvColumn) => {
      const i = columns.get(column);
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };
    const name = cell("name");
    const mpn = cell("mpn");
    if (!name && !mpn) {
      errors.push({ line, message: "Row has neither a name nor an MPN" });
      return;
    }
    const rawQuantity = cell("quantity");
    const quantity = rawQuantity === "" ? 1 : Number(rawQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push({ line, message: `Quantity "${rawQuantity}" is not a positive whole number` });
      return;
    }
    const row: BomCsvRow = {
      line,
      name,
      mpn,
      manufacturer: cell("manufacturer"),
      quantity,
      reference: cell("reference"),
      notes: cell("notes"),
    };
    const key = (mpn || name).toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      existing.reference = [existing.reference, row.reference].filter(Boolean).join(", ");
    } else {
      merged.set(key, row);
    }
  });
  return { rows: [...merged.values()], errors };
}

export const BOM_CSV_HEADER = ["Name", "MPN", "Manufacturer", "Quantity", "Reference", "Notes"];
