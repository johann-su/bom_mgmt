// Pure helpers over the flat list of locations: assembling the tree, the
// human path of a location ("Shelf A › Box 1 › Bin I") and its compact code
// ("A/1/I"). The location pages load every location once (a workshop has
// hundreds, not millions) and do all of this in memory, which keeps the
// queries trivial and the logic unit-testable.

import { compareLabels, parsePattern, type ParsedPattern } from "@/lib/label-pattern";

export type FlatLocation = {
  id: string;
  parentId: string | null;
  label: string;
  name: string;
  type: { id: string; name: string; icon: string; labelPattern: string; position: number };
};

export type LocationNode = FlatLocation & { children: LocationNode[]; depth: number };

// What joins the labels of a code — instance-wide, stored in app_settings
// (src/lib/settings.ts). "" is allowed: box A's bin 1 is then just "A1".
export const CODE_SEPARATOR = "/";
export const MAX_SEPARATOR_LENGTH = 3;

export const SEPARATOR_PRESETS = [
  { label: "Slash", value: "/" },
  { label: "Dash", value: "-" },
  { label: "Dot", value: "." },
  { label: "None", value: "" },
];

/**
 * Checks a code separator. Letters, digits and braces are refused: they'd
 * read as part of a label ("A" + "x" + "1" vs. a label "Ax1"). Whitespace is
 * kept as typed — a space is a legitimate separator.
 */
export function validateSeparator(value: unknown): { separator: string } | { error: string } {
  if (typeof value !== "string") return { error: "Invalid separator" };
  if (value.length > MAX_SEPARATOR_LENGTH) {
    return { error: `The separator can be at most ${MAX_SEPARATOR_LENGTH} characters` };
  }
  if (/[\p{L}\p{N}{}]/u.test(value)) {
    return { error: "The separator can't contain letters, digits or braces" };
  }
  return { separator: value };
}

/** Codes that more than one entry shares — e.g. 1›11 and 11›1 both "111" without a separator. */
export function duplicateCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const code of codes) (seen.has(code) ? dupes : seen).add(code);
  return [...dupes];
}

function patternCache() {
  const cache = new Map<string, ParsedPattern | null>();
  return (source: string) => {
    if (!cache.has(source)) {
      const parsed = parsePattern(source);
      cache.set(source, "error" in parsed ? null : parsed);
    }
    return cache.get(source)!;
  };
}

// Siblings sort by type (its configured position), then by label in the
// type's natural order — Bin II before Bin X, B2 before B10.
export function sortSiblings<T extends FlatLocation>(items: T[]): T[] {
  const pattern = patternCache();
  return [...items].sort(
    (a, b) =>
      a.type.position - b.type.position ||
      a.type.name.localeCompare(b.type.name) ||
      compareLabels(pattern(a.type.labelPattern), a.label, b.label),
  );
}

export function buildTree(locations: FlatLocation[]): LocationNode[] {
  const byParent = new Map<string | null, FlatLocation[]>();
  const ids = new Set(locations.map((l) => l.id));
  for (const location of locations) {
    // A parent outside the list (shouldn't happen) is treated as a root
    // rather than dropping the subtree from view.
    const parent = location.parentId && ids.has(location.parentId) ? location.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), location]);
  }
  const build = (parentId: string | null, depth: number): LocationNode[] =>
    sortSiblings(byParent.get(parentId) ?? []).map((l) => ({
      ...l,
      depth,
      children: build(l.id, depth + 1),
    }));
  return build(null, 0);
}

/** Ancestors from the root down to (and including) the location itself. */
export function ancestry<T extends { id: string; parentId: string | null }>(
  byId: Map<string, T>,
  id: string,
): T[] {
  const chain: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  // `seen` guards against a cycle in corrupt data looping forever.
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export function locationCode(chain: { label: string }[], separator = CODE_SEPARATOR): string {
  return chain.map((l) => l.label).join(separator);
}

export function locationPath(chain: { label: string; type: { name: string } }[]): string {
  return chain.map((l) => `${l.type.name} ${l.label}`).join(" › ");
}

/** Every id in the subtree rooted at `id`, the root included. */
export function subtreeIds(
  locations: { id: string; parentId: string | null }[],
  id: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const l of locations) {
    if (l.parentId) children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.id]);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const next = stack.pop()!;
    if (out.has(next)) continue;
    out.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

/** Code + path for every location, for pickers and search. */
export function describeAll(locations: FlatLocation[], separator = CODE_SEPARATOR) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const pattern = patternCache();
  return locations
    .map((l) => {
      const chain = ancestry(byId, l.id);
      return {
        id: l.id,
        code: locationCode(chain, separator),
        path: locationPath(chain),
        name: l.name,
        chain,
      };
    })
    .sort((a, b) => {
      // Order like a depth-first walk of the sorted tree.
      for (let i = 0; i < Math.min(a.chain.length, b.chain.length); i++) {
        const x = a.chain[i];
        const y = b.chain[i];
        if (x.id === y.id) continue;
        return (
          x.type.position - y.type.position ||
          x.type.name.localeCompare(y.type.name) ||
          compareLabels(pattern(x.type.labelPattern), x.label, y.label)
        );
      }
      return a.chain.length - b.chain.length;
    })
    .map(({ id, code, path, name }) => ({ id, code, path, name }));
}

export type LocationOption = ReturnType<typeof describeAll>[number];
