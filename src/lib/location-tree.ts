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

export const CODE_SEPARATOR = "/";

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

export function locationCode(chain: { label: string }[]): string {
  return chain.map((l) => l.label).join(CODE_SEPARATOR);
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
export function describeAll(locations: FlatLocation[]) {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const pattern = patternCache();
  return locations
    .map((l) => {
      const chain = ancestry(byId, l.id);
      return {
        id: l.id,
        code: locationCode(chain),
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
