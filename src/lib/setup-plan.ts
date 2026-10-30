// The first-run setup wizard (/setup) as pure logic: the example structure
// it explains, validation of what the user ends up with, and the plan of starting
// locations to create. A fresh database has no location types at all — the
// wizard replaces the old Shelf/Box/Bin seed — so everything here must be
// checked server-side too before it becomes rows.
//
// The wizard describes a *regular* hierarchy: level 0 is top level, each
// further level nests inside the previous one, and "count" is how many to
// create in each parent ("3 shelves × 4 boxes × 6 bins"). With a separator
// the types don't constrain nesting, so the user can grow the tree irregularly
// later; without one, each level may hold only the next (the type grammar of
// src/lib/code-grammar.ts), since that's what keeps codes readable.

import { firstLabel, nextLabels, parsePattern, type ParsedPattern } from "@/lib/label-pattern";
import { LOCATION_ICONS } from "@/lib/location-icons";
import { CODE_SEPARATOR, duplicateCodes, validateSeparator } from "@/lib/location-tree";
import { DEFAULT_TEMPLATES, locationVariables, type LabelVariables } from "@/lib/label-template";
import { ambiguityError, findAmbiguity, type GrammarType } from "@/lib/code-grammar";

export type SetupLevel = {
  name: string;
  icon: string;
  labelPattern: string;
  // Index into DEFAULT_TEMPLATES — the label every location of this type gets.
  template: number;
  // Locations to create in each parent (or at top level for level 0).
  count: number;
};

export const MAX_LEVELS = 6;
// Per parent, and in total — a starting tree, not a bulk import.
export const MAX_PER_PARENT = 200;
export const MAX_TOTAL = 1000;

// Built-in template indexes, by role: a QR-linked box label for the big
// containers, a compact Data Matrix sticker for the small ones.
const BIN_LABEL = 0;
const BOX_LABEL = 1;

// The README's hierarchy, shown in the wizard's "example" explainer and
// offered as a one-click starting point: 2 shelves × 4 boxes × 6 bins, coded
// like A/1/IV.
export const EXAMPLE_STRUCTURE: SetupLevel[] = [
  { name: "Shelf", icon: "shelf", labelPattern: "{A}", template: BOX_LABEL, count: 2 },
  { name: "Box", icon: "box", labelPattern: "{N}", template: BOX_LABEL, count: 4 },
  { name: "Bin", icon: "bin", labelPattern: "{R}", template: BIN_LABEL, count: 6 },
];

export type ValidLevel = SetupLevel & { parsed: ParsedPattern };

/**
 * Normalises and checks the wizard's levels. Names are trimmed and must be
 * distinct ignoring case (types are told apart by name everywhere), patterns
 * must parse, and counts must fit both the caps and the pattern — a bounded
 * pattern like `{N:1-4}` can't label 6 siblings.
 */
export function validateSetup(input: SetupLevel[]): { levels: ValidLevel[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "Add at least one level" };
  if (input.length > MAX_LEVELS) return { error: `At most ${MAX_LEVELS} levels` };

  const seen = new Set<string>();
  const levels: ValidLevel[] = [];
  for (const [i, level] of input.entries()) {
    const name = String(level.name ?? "").trim();
    const where = name || `Level ${i + 1}`;
    if (!name) return { error: `${where}: a name is required` };
    if (name.length > 100) return { error: `${where}: the name is too long` };
    if (seen.has(name.toLowerCase())) return { error: `"${name}" is used for two levels` };
    seen.add(name.toLowerCase());

    const labelPattern = String(level.labelPattern ?? "").trim();
    const parsed = parsePattern(labelPattern);
    if ("error" in parsed) return { error: `${where}: ${parsed.error}` };

    const count = Number(level.count);
    if (!Number.isInteger(count) || count < 0) return { error: `${where}: the count must be a whole number` };
    if (count > MAX_PER_PARENT) return { error: `${where}: at most ${MAX_PER_PARENT} per parent` };
    if (nextLabels(parsed, [], count).length < count) {
      return { error: `${where}: the pattern ${labelPattern} has fewer than ${count} labels` };
    }

    const template = Number.isInteger(level.template) && DEFAULT_TEMPLATES[level.template] ? level.template : 0;
    const icon = level.icon in LOCATION_ICONS ? level.icon : "box";
    levels.push({ name, icon, labelPattern, template, count, parsed });
  }

  const total = totalLocations(levels);
  if (total > MAX_TOTAL) return { error: `That would create ${total} locations — at most ${MAX_TOTAL}` };
  return { levels };
}

/**
 * How many locations each level creates: the product of the counts down to
 * it. A level with count 0 stops the chain — there's nothing to nest the
 * deeper levels in, so they only become types.
 */
export function levelTotals(levels: Pick<SetupLevel, "count">[]): number[] {
  let parents = 1;
  return levels.map((level) => (parents *= Math.max(0, Math.floor(level.count) || 0)));
}

export function totalLocations(levels: Pick<SetupLevel, "count">[]): number {
  return levelTotals(levels).reduce((sum, n) => sum + n, 0);
}

/** One location to create; `parent` indexes an earlier entry (null = top level). */
export type PlannedLocation = { level: number; label: string; parent: number | null };

/**
 * The starting tree, flattened so every parent comes before its children
 * (level by level) — inserting in order lets each row reference the id of a
 * row already created. Siblings get the pattern's first labels.
 */
export function planLocations(levels: ValidLevel[]): PlannedLocation[] {
  const plan: PlannedLocation[] = [];
  let parents: (number | null)[] = [null];
  for (const [level, { parsed, count }] of levels.entries()) {
    if (count === 0) break;
    const labels = nextLabels(parsed, [], count);
    const next: number[] = [];
    for (const parent of parents) {
      for (const label of labels) {
        next.push(plan.length);
        plan.push({ level, label, parent });
      }
    }
    parents = next;
  }
  return plan;
}

/** The code of every planned location, in plan order. */
export function plannedCodes(plan: PlannedLocation[], separator: string): string[] {
  const codes: string[] = [];
  for (const p of plan) codes.push(p.parent === null ? p.label : codes[p.parent] + separator + p.label);
  return codes;
}

/**
 * The type grammar the wizard creates, with level indexes as ids: free
 * nesting with a separator, a chain (each level holds only the next) without.
 */
export function setupGrammar(levels: SetupLevel[], separator: string): GrammarType[] {
  return levels.map((level, i) => ({
    id: String(i),
    name: level.name,
    labelPattern: level.labelPattern,
    childTypeIds: separator ? null : i + 1 < levels.length ? [String(i + 1)] : [],
  }));
}

/**
 * Everything the wizard submits, checked as a whole: the levels, the code
 * separator, and that codes stay unique under it — not just the starting
 * tree's but any the grammar allows later. With no separator, boxes {N}
 * holding bins {N} would make 1›11 and 11›1 both "111".
 */
export function prepareSetup(
  input: SetupLevel[],
  separatorInput: unknown,
): { levels: ValidLevel[]; plan: PlannedLocation[]; separator: string } | { error: string } {
  const valid = validateSetup(input);
  if ("error" in valid) return valid;
  const sep = validateSeparator(separatorInput);
  if ("error" in sep) return sep;
  const plan = planLocations(valid.levels);
  const ambiguity = findAmbiguity(setupGrammar(valid.levels, sep.separator), sep.separator);
  if (ambiguity) return { error: ambiguityError(ambiguity, sep.separator) };
  const dupes = duplicateCodes(plannedCodes(plan, sep.separator));
  if (dupes.length > 0) {
    return {
      error: `Codes would repeat (${dupes.slice(0, 3).join(", ")}) — use a separator or alternate letters and numbers between levels`,
    };
  }
  return { levels: valid.levels, plan, separator: sep.separator };
}

/**
 * Label variables for the first location of `level` (A/1/I for the example),
 * so the wizard can show the code and preview each type's label with
 * real-looking values. Levels whose pattern doesn't parse show "?".
 */
export function sampleVariables(
  levels: SetupLevel[],
  level: number,
  url: string,
  separator = CODE_SEPARATOR,
): LabelVariables {
  const chain = levels.slice(0, level + 1).map((l, i) => {
    const parsed = parsePattern(l.labelPattern);
    return {
      id: `sample-${i}`,
      label: "error" in parsed ? "?" : firstLabel(parsed),
      name: "",
      type: { name: l.name.trim() || `Level ${i + 1}` },
    };
  });
  return locationVariables(chain, { url, separator });
}
