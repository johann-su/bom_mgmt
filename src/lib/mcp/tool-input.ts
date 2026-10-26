// Pure translation from MCP tool arguments to what the app's own write paths
// take, kept out of tools.ts (which talks to the DB) so it can be unit-tested.
// The model addresses things the way a person does — locations by code
// ("A/1/IV"), categories by name, a partial patch instead of the full part
// form — and these functions turn that into the form values, ids and
// spreadsheet rows the existing validation already understands. Nothing here
// re-implements validation: parsePartInput and planPartImport still decide
// what a valid part is.

import { InvalidParamsError, ToolError } from "@/lib/mcp/protocol";
import { mergeAttributes, normalizeAttributes, type PartAttribute } from "@/lib/part-attributes";
import { PART_CSV_FIELDS, type PartCsvField, type PartCsvMapping } from "@/lib/part-csv";

export type LocationRef = { id: string; code: string; path: string };

/**
 * Finds a location by what the model calls it: its id, its code ("A/1"), or
 * its full path ("Shelf A / Box 1"). Codes are matched exactly first and then
 * case-insensitively, since labels like "IV" and "iv" are distinct only in
 * theory. An unknown reference is a ToolError naming a few codes, so the
 * model can correct itself instead of guessing again.
 */
export function resolveLocation<T extends LocationRef>(locations: T[], ref: string): T {
  const wanted = ref.trim();
  const lower = wanted.toLowerCase();
  const found =
    locations.find((l) => l.id === wanted || l.code === wanted) ??
    locations.find((l) => l.code.toLowerCase() === lower || l.path.toLowerCase() === lower);
  if (found) return found;
  const sample = locations.slice(0, 15).map((l) => l.code);
  throw new ToolError(
    locations.length === 0
      ? "There are no storage locations yet — create them in the app first."
      : `No location "${wanted}". Use a location code such as ${sample.join(", ")} (list_locations has them all).`,
  );
}

/** How tools name the unsorted pile (stock not put away in a location). */
export const UNSORTED_REF = "unsorted";

/**
 * Like resolveLocation, but for where stock sits: "unsorted" is the part's
 * unsorted pile (null) — unless a real location is called that, which wins.
 */
export function resolveStockPlace<T extends LocationRef>(locations: T[], ref: string): string | null {
  if (ref.trim().toLowerCase() === UNSORTED_REF) {
    const named = locations.find((l) => l.code.toLowerCase() === UNSORTED_REF);
    return named ? named.id : null;
  }
  return resolveLocation(locations, ref).id;
}

/**
 * Attributes as the model may send them: a list of {key, value} or a plain
 * object ({"Package": "DIP-8"}). Normalized like the part form's input.
 */
export function readAttributes(raw: unknown, name = "attributes"): PartAttribute[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return normalizeAttributes(raw);
  if (typeof raw === "object") {
    return normalizeAttributes(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: value === null || value === undefined ? "" : String(value),
      })),
    );
  }
  throw new InvalidParamsError(`"${name}" must be a list of {key, value} or an object`);
}

/** The editable fields of a stored part, as update_part sees them. */
export type StoredPart = {
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

const TEXT_FIELDS = ["name", "description", "manufacturer", "mpn", "unit", "orderUrl", "notes"] as const;

export type PartPatch = Partial<Record<(typeof TEXT_FIELDS)[number], string>> & {
  /** Resolved by the caller from a category name; null clears it. */
  categoryId?: string | null;
  /** null clears the threshold. */
  minStock?: number | null;
  /** Merged by key: existing keys take the new value, new keys append. */
  attributes?: PartAttribute[];
  /** Keys to drop, case-insensitively. */
  removeAttributes?: string[];
};

/**
 * The full part-form values for a partial update: the stored part with only
 * the patched fields changed. A field the patch leaves out is kept as is —
 * the model must never wipe a description just by not mentioning it.
 */
export function partFormValues(existing: StoredPart, patch: PartPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {
    ...existing,
    categoryId: existing.categoryId ?? "",
    minStock: existing.minStock === null ? "" : String(existing.minStock),
  };
  for (const field of TEXT_FIELDS) {
    if (patch[field] !== undefined) values[field] = patch[field];
  }
  if (patch.categoryId !== undefined) values.categoryId = patch.categoryId ?? "";
  if (patch.minStock !== undefined) values.minStock = patch.minStock === null ? "" : String(patch.minStock);

  let attributes = existing.attributes;
  if (patch.attributes?.length) attributes = mergeAttributes(attributes, patch.attributes);
  if (patch.removeAttributes?.length) {
    const drop = new Set(patch.removeAttributes.map((k) => k.trim().toLowerCase()));
    attributes = attributes.filter((a) => !drop.has(a.key.toLowerCase()));
  }
  values.attributes = attributes;
  return values;
}

const IMPORT_FIELDS = new Set<string>(PART_CSV_FIELDS);

/**
 * Turns import_parts' row objects into the spreadsheet the /parts/import
 * planner reads — a header row plus an explicit mapping — so a structured
 * import goes through exactly the same matching (MPN first, then name),
 * location lookup and validation as an uploaded file. Attributes become
 * "Attr: <key>" columns. Unknown keys are rejected rather than ignored: a
 * misspelled "qty" silently dropping every quantity would be worse.
 */
export function importRowsToTable(rows: Record<string, unknown>[]): {
  rows: string[][];
  mapping: PartCsvMapping;
} {
  const fields: PartCsvField[] = [];
  const attributeKeys: string[] = [];
  const seenAttributes = new Set<string>();
  const parsed = rows.map((row, i) => {
    const attributes = readAttributes(row.attributes, `parts[${i}].attributes`);
    for (const key of Object.keys(row)) {
      if (key === "attributes") continue;
      if (!IMPORT_FIELDS.has(key)) {
        throw new InvalidParamsError(
          `parts[${i}] has unknown field "${key}" — allowed: ${[...PART_CSV_FIELDS, "attributes"].join(", ")}`,
        );
      }
      if (!fields.includes(key as PartCsvField)) fields.push(key as PartCsvField);
    }
    for (const { key } of attributes) {
      if (!seenAttributes.has(key.toLowerCase())) {
        seenAttributes.add(key.toLowerCase());
        attributeKeys.push(key);
      }
    }
    return { row, attributes };
  });

  // Keep the planner's field order so the table reads like the template.
  fields.sort((a, b) => PART_CSV_FIELDS.indexOf(a) - PART_CSV_FIELDS.indexOf(b));
  const cell = (value: unknown) =>
    value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

  const headers = [...fields, ...attributeKeys.map((key) => `Attr: ${key}`)];
  const mapping: PartCsvMapping = Object.fromEntries(fields.map((field, i) => [field, i]));
  if (attributeKeys.length) mapping.attributes = attributeKeys.map((_, i) => fields.length + i);

  const body = parsed.map(({ row, attributes }) => {
    const byKey = new Map(attributes.map((a) => [a.key.toLowerCase(), a.value]));
    return [
      ...fields.map((field) => cell(row[field])),
      ...attributeKeys.map((key) => byKey.get(key.toLowerCase()) ?? ""),
    ];
  });
  return { rows: [headers, ...body], mapping };
}
