// Can every location code be read back as exactly one chain of labels?
//
// A code is the labels from the root down, joined by the separator. Sibling
// labels are unique (a DB constraint), so two locations share a code exactly
// when one string splits into labels in two different ways: with no
// separator, Shelf 1 › Box 11 and Shelf 11 › Box 1 are both "111". Which
// splits are possible depends on the label patterns, the separator and which
// types may sit inside which — the *type grammar*.
//
// Everything that can produce a code is a regular language, so this is
// decided exactly, not by sampling:
//
//   1. Build an NFA for all codes: one sub-automaton per type's pattern, a
//      root that may start any type, and from the end of each label an edge
//      that crosses a label *boundary*, reads the separator and continues
//      into each allowed child type.
//   2. Run that NFA against itself on the same input (the self-product) and
//      remember whether the two runs ever crossed a boundary at different
//      positions. If both runs can accept with that flag set, the input is a
//      code with two readings — breadth-first, so the shortest one.
//
// Patterns compile to their exact label sets, except counters with more than
// ENUMERATE_LIMIT values (and roman numerals beyond it), which use their
// character class — [MDCLXVI]+ rather than valid numerals only. That can only
// produce a false alarm, never miss a real collision.

import { formatValue, parsePattern, type CounterToken, type ParsedPattern } from "@/lib/label-pattern";
import { locationPath } from "@/lib/location-tree";

export type GrammarType = {
  id: string;
  name: string;
  labelPattern: string;
  // Types a location of this type may contain; null = any type.
  childTypeIds: string[] | null;
};

export type Reading = { label: string; type: { name: string } }[];
export type Ambiguity = { code: string; readings: [Reading, Reading] };

/** Bounded counters up to this many values are compiled to their exact labels. */
export const ENUMERATE_LIMIT = 200;

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = UPPER.toLowerCase();
const DIGITS = "0123456789";
const ROMAN = "IVXLCDM";

// --- the automaton --------------------------------------------------------

type State = {
  // Letter edges: `chars` is the set of characters the edge reads.
  edges: { to: number; chars: string }[];
  // Empty edges; a `boundary` one ends a label (and is where splits differ).
  eps: { to: number; boundary: boolean }[];
  // Index of the type whose label can end here, if any.
  endOf: number | null;
};

class Nfa {
  states: State[] = [];
  add(): number {
    this.states.push({ edges: [], eps: [], endOf: null });
    return this.states.length - 1;
  }
  char(from: number, to: number, chars: string) {
    this.states[from].edges.push({ to, chars });
  }
  eps(from: number, to: number, boundary = false) {
    this.states[from].eps.push({ to, boundary });
  }
}

// A set of words as a trie hanging off `from`; returns the word-end states.
function trie(nfa: Nfa, from: number, words: string[]): number[] {
  const next = new Map<string, number>();
  const ends = new Set<number>();
  for (const word of words) {
    let at = from;
    for (const ch of word) {
      const key = `${at}:${ch}`;
      let to = next.get(key);
      if (to === undefined) {
        to = nfa.add();
        next.set(key, to);
        nfa.char(at, to, ch);
      }
      at = to;
    }
    ends.add(at);
  }
  return [...ends];
}

// One or more characters of a class: from -c-> t, t -c-> t.
function repeat(nfa: Nfa, from: number, chars: string): number[] {
  const to = nfa.add();
  nfa.char(from, to, chars);
  nfa.char(to, to, chars);
  return [to];
}

function counter(nfa: Nfa, from: number, token: CounterToken): number[] {
  if (token.max !== null && token.max - token.min < ENUMERATE_LIMIT) {
    const words: string[] = [];
    for (let v = token.min; v <= token.max; v++) words.push(formatValue(token, v));
    return trie(nfa, from, words);
  }
  switch (token.kind) {
    case "A":
      return repeat(nfa, from, UPPER);
    case "a":
      return repeat(nfa, from, LOWER);
    case "R":
      return repeat(nfa, from, ROMAN);
    case "r":
      return repeat(nfa, from, ROMAN.toLowerCase());
    case "N": {
      if (token.width) {
        let at = from;
        for (let i = 0; i < token.width; i++) {
          const to = nfa.add();
          nfa.char(at, to, DIGITS);
          at = to;
        }
        return [at];
      }
      // Natural numbers: no leading zeros; "0" itself only if the range has it.
      const digits = nfa.add();
      nfa.char(from, digits, DIGITS.slice(1));
      nfa.char(digits, digits, DIGITS);
      const ends = [digits];
      if (token.min === 0) ends.push(...trie(nfa, from, ["0"]));
      return ends;
    }
  }
}

// One type's labels: returns its start state and the states a label ends in.
function label(nfa: Nfa, pattern: ParsedPattern): { start: number; ends: number[] } {
  const start = nfa.add();
  let heads = [start];
  for (const token of pattern.tokens) {
    let from = heads[0];
    if (heads.length > 1) {
      from = nfa.add();
      for (const head of heads) nfa.eps(head, from);
    }
    if (token.type === "literal") {
      for (const ch of token.text) {
        const to = nfa.add();
        nfa.char(from, to, ch);
        from = to;
      }
      heads = [from];
    } else {
      heads = counter(nfa, from, token);
    }
  }
  return { start, ends: heads };
}

function buildCodeNfa(types: { pattern: ParsedPattern; children: number[] }[], separator: string) {
  const nfa = new Nfa();
  const root = nfa.add();
  const labels = types.map((t) => label(nfa, t.pattern));
  types.forEach((type, i) => {
    nfa.eps(root, labels[i].start);
    for (const end of labels[i].ends) nfa.states[end].endOf = i;
    if (type.children.length === 0) return;
    let after = nfa.add();
    for (const end of labels[i].ends) nfa.eps(end, after, true);
    for (const ch of separator) {
      const to = nfa.add();
      nfa.char(after, to, ch);
      after = to;
    }
    for (const child of type.children) nfa.eps(after, labels[child].start);
  });
  return { nfa, root };
}

// --- the self-product -----------------------------------------------------

// A state reachable without reading a letter, and the type whose label was
// ended on the way (null when no boundary was crossed).
type Reach = { state: number; crossed: number | null };

function closures(nfa: Nfa) {
  const cache = new Map<number, Reach[]>();
  return (from: number): Reach[] => {
    let out = cache.get(from);
    if (out) return out;
    out = [];
    const seen = new Set<string>();
    const stack: Reach[] = [{ state: from, crossed: null }];
    while (stack.length) {
      const reach = stack.pop()!;
      const key = `${reach.state}:${reach.crossed !== null}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(reach);
      for (const e of nfa.states[reach.state].eps) {
        const crossed = e.boundary ? nfa.states[reach.state].endOf : reach.crossed;
        stack.push({ state: e.to, crossed });
      }
    }
    cache.set(from, out);
    return out;
  };
}

function commonChar(a: string, b: string): string | null {
  for (const ch of a) if (b.includes(ch)) return ch;
  return null;
}

type Node = {
  p: number;
  q: number;
  // The two runs have split the input differently somewhere.
  split: boolean;
  prev: number;
  ch: string;
  // Boundaries crossed right before `ch` (the type of the label ended).
  crossP: number | null;
  crossQ: number | null;
};

/**
 * The shortest code with two readings under this grammar and separator, or
 * null when every code names one chain of labels. Every type may sit at the
 * top level; types with an invalid pattern can't have labels and are left out.
 */
export function findAmbiguity(types: GrammarType[], separator: string): Ambiguity | null {
  const valid = types.flatMap((t) => {
    const parsed = parsePattern(t.labelPattern);
    return "error" in parsed ? [] : [{ ...t, pattern: parsed }];
  });
  const index = new Map(valid.map((t, i) => [t.id, i]));
  const all = valid.map((_, i) => i);
  const grammar = valid.map((t) => ({
    pattern: t.pattern,
    children:
      t.childTypeIds === null ? all : t.childTypeIds.flatMap((id) => index.get(id) ?? []),
  }));
  const { nfa, root } = buildCodeNfa(grammar, separator);
  const closure = closures(nfa);

  const nodes: Node[] = [{ p: root, q: root, split: false, prev: -1, ch: "", crossP: null, crossQ: null }];
  const seen = new Set<string>([`${root}:${root}:false`]);
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at];
    for (const a of closure(node.p)) {
      for (const b of closure(node.q)) {
        const split = node.split || (a.crossed !== null) !== (b.crossed !== null);
        const endA = nfa.states[a.state].endOf;
        const endB = nfa.states[b.state].endOf;
        if (split && a.crossed === null && b.crossed === null && endA !== null && endB !== null) {
          return witness(nodes, at, [endA, endB], valid, separator);
        }
        for (const ea of nfa.states[a.state].edges) {
          for (const eb of nfa.states[b.state].edges) {
            const ch = commonChar(ea.chars, eb.chars);
            if (ch === null) continue;
            const key = `${ea.to}:${eb.to}:${split}`;
            if (seen.has(key)) continue;
            seen.add(key);
            nodes.push({ p: ea.to, q: eb.to, split, prev: at, ch, crossP: a.crossed, crossQ: b.crossed });
          }
        }
      }
    }
  }
  return null;
}

function witness(
  nodes: Node[],
  last: number,
  [lastP, lastQ]: [number, number],
  types: { name: string }[],
  separator: string,
): Ambiguity {
  const path: Node[] = [];
  for (let at = last; at > 0; at = nodes[at].prev) path.unshift(nodes[at]);
  const code = path.map((n) => n.ch).join("");
  const reading = (cut: (n: Node) => number | null, lastType: number): Reading => {
    const out: Reading = [];
    let start = 0;
    path.forEach((n, i) => {
      const type = cut(n);
      if (type === null) return;
      out.push({ label: code.slice(start, i), type: types[type] });
      start = i + separator.length;
    });
    out.push({ label: code.slice(start), type: types[lastType] });
    return out;
  };
  return { code, readings: [reading((n) => n.crossP, lastP), reading((n) => n.crossQ, lastQ)] };
}

/** `"111" can mean Shelf 1 › Box 11 or Shelf 11 › Box 1` */
export function describeAmbiguity(ambiguity: Ambiguity): string {
  const [a, b] = ambiguity.readings;
  return `"${ambiguity.code}" can mean ${locationPath(a)} or ${locationPath(b)}`;
}

/** The refusal for a change that would make codes ambiguous, with what to do about it. */
export function ambiguityError(ambiguity: Ambiguity, separator: string): string {
  const fix = separator
    ? `the separator "${separator}" also occurs inside a label pattern — change one of them`
    : "restrict which types each type can hold (Settings → Location types) or use a separator";
  return `Codes would be ambiguous: ${describeAmbiguity(ambiguity)} — ${fix}`;
}

// --- the grammar itself ---------------------------------------------------

// Stands for a type being created in its own child list, before it has an id.
export const SELF_TYPE = "self";

/** Whether a location of `parent`'s type may contain one of `childTypeId`. */
export function allowsChild(parent: { childTypeIds: string[] | null }, childTypeId: string): boolean {
  return parent.childTypeIds === null || parent.childTypeIds.includes(childTypeId);
}

/**
 * The child types each type actually holds today — the grammar an
 * unrestricted type is narrowed to when codes lose their separator, so
 * nothing that exists becomes invalid.
 */
export function observedChildTypes(
  locations: { id: string; parentId: string | null; type: { id: string } }[],
): Map<string, string[]> {
  const typeOf = new Map(locations.map((l) => [l.id, l.type.id]));
  const out = new Map<string, Set<string>>();
  for (const l of locations) {
    const parentType = l.parentId ? typeOf.get(l.parentId) : undefined;
    if (!parentType) continue;
    out.set(parentType, (out.get(parentType) ?? new Set()).add(l.type.id));
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

/**
 * Pairs that break the grammar: locations inside a parent whose type no
 * longer allows them, as "Shelf › Bin" (distinct type pairs).
 */
export function grammarViolations(
  locations: { id: string; parentId: string | null; type: { id: string; name: string } }[],
  types: GrammarType[],
): string[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const grammar = new Map(types.map((t) => [t.id, t]));
  const out = new Set<string>();
  for (const l of locations) {
    const parent = l.parentId ? byId.get(l.parentId) : undefined;
    const rule = parent && grammar.get(parent.type.id);
    if (rule && !allowsChild(rule, l.type.id)) out.add(`${parent.type.name} › ${l.type.name}`);
  }
  return [...out];
}
