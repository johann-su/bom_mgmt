// Generic parts: things fully identified by a family and a few parameters
// (ISO 4762 M3×8 A2-70, JST XH 4-pin housing), so the "Generic part" wizard
// can derive the name, designation, specs and icon instead of looking them
// up. Each family is a pure module (src/lib/fasteners.ts,
// src/lib/connectors.ts) exposing its types through the interface below,
// registered in src/lib/generic-families.ts; the dialog and the bulk-create
// action only speak this interface.

import type { PartAttribute } from "@/lib/part-attributes";

/** A part a generic type describes, in the part form's terms. */
export type GeneratedPart = {
  name: string;
  description: string; // Markdown
  manufacturer: string; // "" for generic parts
  mpn: string; // the designation BOM imports match on; "" if there is none
  unit: string;
  category: string[]; // broadest first, for suggestCategory
  icon: string; // label-icon catalogue id: the part's thumbnail until it has a photo
  /** Catalogue icons for the wizard's preview, left to right, as on a bin
   *  label (drive + side view, connector series + piece). Not stored. */
  preview: string[];
  /** Specs, then the picture attributes ("icon-1": head, "icon-2": drive)
   *  that bin label graphics show (iconAttributes in part-attributes.ts). */
  attributes: PartAttribute[];
};

export type GenerateResult = GeneratedPart | { error: string };

export type SelectParam = {
  kind: "select";
  id: string;
  label: string;
  options: { value: string; label: string }[];
  /** Picked when nothing valid is chosen yet; else the first option. */
  default?: string;
};

/** A parameter the user may pick several values of, making one part each
 *  (lengths, pin counts). At most one per type. */
export type RangeParam = {
  kind: "range";
  id: string;
  label: string;
  options: string[]; // the common values, offered as chips
  /** A typed value as an option ("5,7" → "5.7"), or null if it isn't valid. */
  parse: (raw: string) => string | null;
  placeholder: string; // for the "other value" input
};

export type GenericParam = SelectParam | RangeParam;
export type GenericValues = Record<string, string>;

/**
 * The wizard choice a part was made from, stored on the part (parts.generic)
 * so editing reopens the wizard on it. `values` holds one value per parameter
 * the type offered, the range parameter included ("length": "8"). Ids are
 * stored data: renaming a type, option value or parameter id orphans the
 * specs that use it (resolveSpec then reports them stale).
 */
export type GenericSpec = { family: string; type: string; values: GenericValues };

/** A stored or submitted spec's shape, or null if it isn't one. Doesn't
 *  check that the ids exist — a stale spec is kept, not dropped. */
export function parseGenericSpec(raw: unknown): GenericSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const { family, type, values } = raw as Record<string, unknown>;
  const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100;
  if (!id(family) || !id(type) || !values || typeof values !== "object" || Array.isArray(values)) return null;
  const entries = Object.entries(values);
  if (entries.length > 20 || !entries.every(([k, v]) => id(k) && typeof v === "string" && v.length <= 100)) {
    return null;
  }
  return { family, type, values: Object.fromEntries(entries) as GenericValues };
}

export type GenericType = {
  id: string;
  label: string; // tile caption: "Socket head cap screw", "JST XH"
  detail: string; // tile subcaption: "ISO 4762", "2.5 mm"
  title: string; // tooltip
  icon: string; // tile icon (catalogue id)
  /** The parameters, given what's chosen so far — a choice can change what
   *  else applies (a crimp contact has no pin count). */
  params: (values: GenericValues) => GenericParam[];
  generate: (values: GenericValues) => GenerateResult;
};

export type GenericFamily = {
  id: string;
  label: string;
  description: string; // what the wizard fills in for this family
  types: GenericType[];
};

/**
 * Completes `values` for a type: every select gets a valid choice (kept if
 * still offered, so switching from socket head to button head keeps M4, else
 * its default). Repeats until stable, since one choice can change another
 * parameter's options. Range values are left as they are.
 */
export function resolveValues(
  type: GenericType,
  values: GenericValues,
): { values: GenericValues; params: GenericParam[] } {
  let current = { ...values };
  for (let round = 0; round < 5; round++) {
    const params = type.params(current);
    const next = { ...current };
    for (const param of params) {
      if (param.kind !== "select" || param.options.some((o) => o.value === next[param.id])) continue;
      const fallback = param.options.find((o) => o.value === param.default) ?? param.options[0];
      next[param.id] = fallback?.value ?? "";
    }
    if (params.every((p) => next[p.id] === current[p.id])) return { values: current, params };
    current = next;
  }
  return { values: current, params: type.params(current) };
}

export const rangeParam = (params: GenericParam[]) =>
  params.find((p): p is RangeParam => p.kind === "range");

/** Range values in ascending numeric order, duplicates dropped. */
export function sortRange(range: string[]): string[] {
  return [...new Set(range)].sort((a, b) => Number(a) - Number(b));
}

/**
 * One part per range value (or a single part when the type has no range
 * parameter), for creating a whole range at once. Each value goes through the
 * parameter's own parse, so this is safe on untrusted input; any invalid
 * value or spec errors. Each part comes with the values it was generated
 * from, for its stored spec (specFor).
 */
export function generateRange(
  type: GenericType,
  values: GenericValues,
  range: string[],
): { part: GeneratedPart; values: GenericValues }[] | { error: string } {
  const resolved = resolveValues(type, values);
  const param = rangeParam(resolved.params);
  if (!param) {
    const part = type.generate(resolved.values);
    return "error" in part ? part : [{ part, values: resolved.values }];
  }
  const parsed = range.map((raw) => param.parse(String(raw)));
  if (parsed.some((v) => v === null)) return { error: `Invalid ${param.label.toLowerCase()}` };
  const chosen = sortRange(parsed as string[]);
  if (chosen.length === 0) return { error: `Pick at least one ${param.label.toLowerCase()}` };
  if (chosen.length > 50) return { error: "Pick at most 50 at once" };
  const out: { part: GeneratedPart; values: GenericValues }[] = [];
  for (const value of chosen) {
    const each = { ...resolved.values, [param.id]: value };
    const part = type.generate(each);
    if ("error" in part) return part;
    out.push({ part, values: each });
  }
  return out;
}

/** Parses a whole number in [min, max] — a pin count, a row count. */
export function parseCount(raw: string, min: number, max: number): string | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? String(n) : null;
}

/** The spec to store for a generated part: just the values of the
 *  parameters `type` offers for them, so stray keys left over from other
 *  types in the wizard aren't kept. `values` must hold the range value. */
export function specFor(family: string, type: GenericType, values: GenericValues): GenericSpec {
  const ids = type.params(values).map((p) => p.id);
  return {
    family,
    type: type.id,
    values: Object.fromEntries(ids.filter((id) => id in values).map((id) => [id, values[id]])),
  };
}

/**
 * Every combination of select values a type offers, following how one choice
 * changes the others, without the range value. Skips combinations the wizard
 * can't reach (a later choice rules an earlier one out: a male crimp pin with
 * make "JST"). For tests and the spec backfill, not the UI.
 */
export function* selectCombinations(type: GenericType, values: GenericValues = {}): Generator<GenericValues> {
  const open = type.params(values).find((p) => p.kind === "select" && !(p.id in values));
  if (open && open.kind === "select") {
    for (const option of open.options) yield* selectCombinations(type, { ...values, [open.id]: option.value });
    return;
  }
  const resolved = resolveValues(type, values).values;
  if (Object.keys(values).every((key) => resolved[key] === values[key])) yield values;
}
