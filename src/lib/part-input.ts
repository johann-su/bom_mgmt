import { normalizeAttributes, type PartAttribute } from "@/lib/part-attributes";

export type PartInput = {
  name: string;
  description: string;
  categoryId: string | null;
  manufacturer: string;
  mpn: string;
  unit: string;
  minStock: number | null;
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

  const categoryId = text("categoryId");
  return {
    name,
    description: text("description", 5000),
    categoryId: categoryId && categoryId !== "none" ? categoryId : null,
    manufacturer: text("manufacturer", 200),
    mpn: text("mpn", 200),
    // Blank unit means the default; units are short labels, not prose.
    unit: text("unit", 20) || "pcs",
    minStock,
    attributes: normalizeAttributes(raw.attributes),
    notes: text("notes", 10000),
  };
}
