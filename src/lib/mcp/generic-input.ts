// The "Generic part" wizard (src/lib/generic-parts.ts) as MCP tools see it:
// a catalogue the model can browse, and strict reading of the choice it
// sends. Pure, like tool-input.ts. Unlike the dialog — where an option that
// stops applying quietly falls back to a default the user sees — a model's
// value that isn't offered is an error naming the options, so asking for
// titanium never creates an A2 screw.

import { applyGenerated, type GeneratedField } from "@/lib/generic-fill";
import { GENERIC_FAMILIES, resolveSpec } from "@/lib/generic-families";
import {
  rangeParam,
  resolveValues,
  specFor,
  type GeneratedPart,
  type GenericParam,
  type GenericType,
  type GenericValues,
  type RangeParam,
} from "@/lib/generic-parts";
import { InvalidParamsError, ToolError } from "@/lib/mcp/protocol";
import type { StoredPart } from "@/lib/mcp/tool-input";

/** Every family and type, for picking one. */
export function genericCatalogue() {
  return GENERIC_FAMILIES.map((f) => ({
    family: f.id,
    label: f.label,
    description: f.description,
    types: f.types.map((t) => ({ type: t.id, label: t.label, detail: t.detail, title: t.title })),
  }));
}

/** A family + type by id, or a ToolError listing the valid ones. */
export function requireGenericType(family: string, type: string): GenericType {
  const f = GENERIC_FAMILIES.find((x) => x.id === family);
  if (!f) {
    throw new ToolError(`No generic family "${family}". Families: ${GENERIC_FAMILIES.map((x) => x.id).join(", ")}.`);
  }
  const t = f.types.find((x) => x.id === type);
  if (!t) throw new ToolError(`No type "${type}" in ${family}. Types: ${f.types.map((x) => x.id).join(", ")}.`);
  return t;
}

/** `values` as sent: an object of strings (numbers are taken as text). */
export function readGenericValues(raw: unknown): GenericValues {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new InvalidParamsError('"values" must be an object');
  const out: GenericValues = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" && typeof value !== "number") {
      throw new InvalidParamsError(`"values.${key}" must be a string`);
    }
    out[key] = String(value);
  }
  return out;
}

const optionList = (param: Extract<GenericParam, { kind: "select" }>) =>
  param.options.map((o) => (o.label === o.value ? o.value : `${o.value} (${o.label})`)).join(", ");

/**
 * Resolves the model's values for a type: a select may be given by value or
 * by label, case-insensitively ("m3", "Stainless steel A2"); what's left out
 * gets the wizard's default. A value the type doesn't offer — or a parameter
 * it doesn't have — is a ToolError naming what it does offer. The range
 * value (length, pins) is checked separately (readRange).
 */
export function resolveStrict(type: GenericType, given: GenericValues): { values: GenericValues; params: GenericParam[] } {
  // Labels to values; repeated since one choice changes another's options.
  const named = { ...given };
  for (let round = 0; round < 5; round++) {
    let changed = false;
    for (const param of type.params(named)) {
      const raw = named[param.id];
      if (param.kind !== "select" || raw === undefined || param.options.some((o) => o.value === raw)) continue;
      const wanted = raw.trim().toLowerCase();
      const option = param.options.find((o) => o.value.toLowerCase() === wanted || o.label.toLowerCase() === wanted);
      if (option) {
        named[param.id] = option.value;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const resolved = resolveValues(type, named);
  for (const [id, value] of Object.entries(named)) {
    const param = resolved.params.find((p) => p.id === id);
    if (!param) {
      throw new ToolError(
        `"${type.id}" has no parameter "${id}" with these values. Its parameters: ${resolved.params.map((p) => p.id).join(", ")}.`,
      );
    }
    if (param.kind === "select" && resolved.values[id] !== value) {
      throw new ToolError(`"${given[id]}" isn't offered for ${param.label} here. Options: ${optionList(param)}.`);
    }
  }
  return resolved;
}

/**
 * The range values (lengths, pin counts) to generate: `range` and/or the
 * range parameter's id in `values`, each parsed like the wizard's "other
 * value" input ("5,7", "8 mm"). Invalid ones are a ToolError.
 */
export function readRange(param: RangeParam | undefined, values: GenericValues, raw: unknown): string[] {
  const list = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  if (!param) {
    if (list.length) throw new ToolError("This type has no range parameter; leave out `range`.");
    return [];
  }
  const given = [...(values[param.id] !== undefined ? [values[param.id]] : []), ...list.map(String)];
  return given.map((value) => {
    const parsed = param.parse(value);
    if (parsed === null) {
      throw new ToolError(`"${value}" isn't a valid ${param.label.toLowerCase()}. Common values: ${param.options.join(", ")}.`);
    }
    return parsed;
  });
}

/** What the model sees of a generated part. */
export function generatedPartView(part: GeneratedPart) {
  return {
    name: part.name,
    mpn: part.mpn,
    manufacturer: part.manufacturer,
    description: part.description,
    category: part.category.join(" / "),
    attributes: part.attributes,
  };
}

/**
 * A type's parameters as the wizard shows them for `values` (resolved,
 * defaults filled), plus a preview of the part(s) they make.
 */
export function describeGenericType(family: string, type: GenericType, given: GenericValues, rawRange: unknown) {
  const { values, params } = resolveStrict(type, given);
  const range = rangeParam(params);
  const chosen = readRange(range, given, rawRange);
  const selects = { ...values };
  if (range) delete selects[range.id];
  const previews = range ? chosen.slice(0, 50).map((v) => type.generate({ ...selects, [range.id]: v })) : [type.generate(values)];
  return {
    family,
    type: type.id,
    label: type.label,
    title: type.title,
    values: selects,
    parameters: params.map((p) =>
      p.kind === "select"
        ? { id: p.id, label: p.label, kind: p.kind, value: values[p.id], options: p.options }
        : {
            id: p.id,
            label: p.label,
            kind: p.kind,
            note: "Pass one or more values as `range` (several make one part each); any valid value works, not only the common ones.",
            commonValues: p.options,
          },
    ),
    preview: range && chosen.length === 0
      ? { note: `Pass a ${range.label.toLowerCase()} in \`range\` to preview the part.` }
      : previews.map((p) => ("error" in p ? p : generatedPartView(p))),
  };
}

/** A `{ family, type, values }` argument, with the type looked up. */
export function readGenericChoice(raw: unknown, name: string): { family: string; type: GenericType; values: GenericValues } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidParamsError(`"${name}" must be an object with family, type and values`);
  }
  const { family, type, values } = raw as Record<string, unknown>;
  if (typeof family !== "string" || typeof type !== "string") {
    throw new InvalidParamsError(`"${name}.family" and "${name}.type" must be strings (describe_generic_part lists them)`);
  }
  return { family, type: requireGenericType(family, type), values: readGenericValues(values) };
}

/**
 * Re-runs the wizard on a stored part, as "Edit generic part" does in the
 * form: the part takes the new generated fields, except those edited by
 * hand since the last fill (judged against the part's stored spec), and the
 * new spec. The range value must be a single one in `values`.
 */
export function applyGenericChoice(
  existing: StoredPart,
  choice: { family: string; type: GenericType; values: GenericValues },
): { part: StoredPart; kept: GeneratedField[]; category: string[] } {
  const { values, params } = resolveStrict(choice.type, choice.values);
  const range = rangeParam(params);
  const chosen = readRange(range, choice.values, undefined);
  if (range && chosen.length !== 1) {
    throw new ToolError(`Pass exactly one ${range.label.toLowerCase()} as values.${range.id}.`);
  }
  const full = range ? { ...values, [range.id]: chosen[0] } : values;
  const next = choice.type.generate(full);
  if ("error" in next) throw new ToolError(next.error);

  const restored = existing.generic && resolveSpec(existing.generic);
  const before = restored && restored.type.generate(restored.values);
  const result = applyGenerated(
    {
      fields: {
        name: existing.name,
        description: existing.description,
        manufacturer: existing.manufacturer,
        mpn: existing.mpn,
        unit: existing.unit,
      },
      icon: existing.icon,
      attributes: existing.attributes,
    },
    before && !("error" in before) ? before : null,
    next,
  );
  return {
    part: {
      ...existing,
      ...result.fields,
      icon: result.icon,
      attributes: result.attributes,
      generic: specFor(choice.family, choice.type, full),
    },
    kept: result.kept,
    category: next.category,
  };
}
