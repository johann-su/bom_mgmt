// How the part form takes a part from the "Generic part" wizard. Pure, so the
// rules are unit-tested (generic-fill.test.ts) without React, and shared with
// the MCP update_part tool.

import type { GeneratedPart } from "@/lib/generic-parts";
import { mergeAttributes, type PartAttribute } from "@/lib/part-attributes";

export const GENERATED_FIELDS = ["name", "description", "manufacturer", "mpn", "unit"] as const;
export type GeneratedField = (typeof GENERATED_FIELDS)[number];

export type GenericFillInput = {
  fields: Record<GeneratedField, string>;
  icon: string;
  attributes: PartAttribute[];
};

/**
 * Applies a generated part to the form. `previous` is what the wizard made
 * last time (regenerated from the part's stored spec), or null for a first
 * fill.
 *
 * - Without `previous`, the wizard replaces the text fields and icon — the
 *   user just chose it.
 * - With it, a field still holding the old generated text (or empty) is
 *   replaced; one the user edited is kept and listed in `kept`, so changing a
 *   screw's material doesn't undo a hand-written name.
 * - Attributes: the new generated ones take their keys' values, old
 *   generated ones the new part doesn't have are dropped (a screw turned into
 *   a nut loses "Length"), and the user's own keys stay.
 */
export function applyGenerated(
  current: GenericFillInput,
  previous: GeneratedPart | null,
  next: GeneratedPart,
): GenericFillInput & { kept: GeneratedField[] } {
  const replaceable = (value: string, old: string | undefined) =>
    !previous || !value.trim() || value.trim() === old?.trim();

  const fields = { ...current.fields };
  const kept: GeneratedField[] = [];
  for (const field of GENERATED_FIELDS) {
    if (replaceable(current.fields[field], previous?.[field])) fields[field] = next[field];
    else if (current.fields[field].trim() !== next[field]) kept.push(field);
  }

  const key = (a: PartAttribute) => a.key.trim().toLowerCase();
  const nextKeys = new Set(next.attributes.map(key));
  const oldGenerated = new Set(previous?.attributes.map((a) => `${key(a)}\n${a.value.trim()}`));
  const own = current.attributes.filter(
    (a) =>
      (a.key.trim() || a.value.trim()) &&
      (nextKeys.has(key(a)) || !oldGenerated.has(`${key(a)}\n${a.value.trim()}`)),
  );

  return {
    fields,
    icon: replaceable(current.icon, previous?.icon) ? next.icon : current.icon,
    attributes: mergeAttributes(own, next.attributes),
    kept,
  };
}

/**
 * The part's attributes plus the generated ones it doesn't have a key for
 * yet, for backfilling attributes a newer wizard adds ("Head") onto parts
 * made before. Each goes where the wizard puts it — after the generated
 * attribute before it — and values the part already has, edited or not, are
 * never touched. Null when nothing is missing.
 */
export function withMissingAttributes(current: PartAttribute[], generated: PartAttribute[]): PartAttribute[] | null {
  const key = (a: PartAttribute) => a.key.trim().toLowerCase();
  const out = [...current];
  let added = false;
  for (const [i, attr] of generated.entries()) {
    if (out.some((a) => key(a) === key(attr))) continue;
    const before = new Set(generated.slice(0, i).map(key));
    const after = out.findLastIndex((a) => before.has(key(a)));
    out.splice(after + 1, 0, attr);
    added = true;
  }
  return added ? out : null;
}
