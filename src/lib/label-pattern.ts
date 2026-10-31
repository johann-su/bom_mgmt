// Label patterns for storage locations: how the members of one location type
// ("Shelf", "Box", "Bin", …) are named. A pattern mixes literal text with
// counter tokens in braces, regex-style:
//
//   {A}  uppercase letters, bijective base 26: A … Z, AA, AB, …
//   {a}  lowercase letters: a … z, aa, …
//   {N}  a decimal number: 1, 2, … 10, 11
//   {NN} zero-padded to a fixed width (as many digits as Ns): 01 … 99
//   {R}  uppercase roman numerals: I, II, III, IV, …
//   {r}  lowercase roman numerals: i, ii, …
//
// Any token can carry an inclusive range written in its own notation —
// {N:0-9}, {A:A-F}, {R:I-XII} — which bounds what validates and makes the
// counter roll over when generating the next label. Without a range a counter
// starts at 1 (A, 1, I) and never runs out. `{{` and `}}` are literal braces.
//
// Multiple counters form an odometer, so "alpha-numeric" grids work:
// "{A}{N:1-6}" generates A1 … A6, B1 … B6, …, and "S-{NN}" gives S-01 … S-99.
//
// Everything here is pure — the location actions use it to validate labels,
// suggest the next free one and sort siblings in their natural order.

export type TokenKind = "A" | "a" | "N" | "R" | "r";

export type PatternToken =
  | { type: "literal"; text: string }
  | {
      type: "counter";
      kind: TokenKind;
      // Fixed digit count for zero-padded {NN…}; null = natural width.
      width: number | null;
      min: number;
      // Inclusive upper bound; null = unbounded.
      max: number | null;
    };

export type CounterToken = Extract<PatternToken, { type: "counter" }>;

export type ParsedPattern = {
  source: string;
  tokens: PatternToken[];
  counters: CounterToken[];
  regex: RegExp;
};

const ROMAN_MAX = 3999;

// --- value <-> text for each counter kind ---------------------------------

function lettersToNumber(text: string): number {
  let n = 0;
  for (const ch of text.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numberToLetters(n: number): string {
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const ROMAN_TABLE: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function toRoman(n: number): string {
  let out = "";
  for (const [value, symbol] of ROMAN_TABLE) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

// Strict: only canonical numerals parse ("IIII" and "IC" are rejected), so a
// label has exactly one spelling and sibling uniqueness can't be dodged.
export function fromRoman(text: string): number | null {
  const upper = text.toUpperCase();
  if (!/^[MDCLXVI]+$/.test(upper)) return null;
  const values: Record<string, number> = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let n = 0;
  for (let i = 0; i < upper.length; i++) {
    const v = values[upper[i]];
    const next = values[upper[i + 1]] ?? 0;
    n += v < next ? -v : v;
  }
  if (n < 1 || n > ROMAN_MAX || toRoman(n) !== upper) return null;
  return n;
}

export function formatValue(token: CounterToken, value: number): string {
  switch (token.kind) {
    case "A":
      return numberToLetters(value);
    case "a":
      return numberToLetters(value).toLowerCase();
    case "R":
      return toRoman(value);
    case "r":
      return toRoman(value).toLowerCase();
    case "N":
      return token.width ? String(value).padStart(token.width, "0") : String(value);
  }
}

// Parses one counter's text in that counter's notation (no range check).
function parseValue(kind: TokenKind, text: string): number | null {
  switch (kind) {
    case "A":
      return /^[A-Z]+$/.test(text) ? lettersToNumber(text) : null;
    case "a":
      return /^[a-z]+$/.test(text) ? lettersToNumber(text) : null;
    case "R":
      return /^[MDCLXVI]+$/.test(text) ? fromRoman(text) : null;
    case "r":
      return /^[mdclxvi]+$/.test(text) ? fromRoman(text) : null;
    case "N":
      return /^\d+$/.test(text) ? Number(text) : null;
  }
}

function tokenRegex(token: CounterToken): string {
  switch (token.kind) {
    case "A":
      return "([A-Z]+)";
    case "a":
      return "([a-z]+)";
    case "R":
      return "([MDCLXVI]+)";
    case "r":
      return "([mdclxvi]+)";
    case "N":
      // Natural numbers carry no leading zeros (else "01" and "1" would be
      // two labels for the same slot).
      return token.width ? `(\\d{${token.width}})` : "(0|[1-9]\\d*)";
  }
}

// Character class a token's text is drawn from, to detect patterns whose
// labels can't be split back into counters ("{N}{N}": is 123 1|23 or 12|3?).
function charClass(token: CounterToken): string {
  if (token.kind === "N") return "digit";
  return token.kind === "A" || token.kind === "R" ? "upper" : "lower";
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- pattern parsing ------------------------------------------------------

const TOKEN_BODY = /^(A|a|R|r|N+)(?::([^-]+)-([^-]+))?$/;

function parseCounter(body: string): CounterToken | string {
  const match = TOKEN_BODY.exec(body.trim());
  if (!match) {
    return `Unknown token {${body}} — use A, a, N, NN…, R or r, optionally with a range like {N:1-12}`;
  }
  const [, rawKind, rawMin, rawMax] = match;
  const kind = (rawKind.startsWith("N") ? "N" : rawKind) as TokenKind;
  const width = kind === "N" && rawKind.length > 1 ? rawKind.length : null;

  let min = 1;
  let max: number | null = width ? 10 ** width - 1 : kind === "R" || kind === "r" ? ROMAN_MAX : null;
  if (rawMin !== undefined) {
    const lo = parseValue(kind, rawMin.trim());
    const hi = parseValue(kind, rawMax.trim());
    if (lo === null || hi === null) {
      return `Range in {${body}} must be written in the token's own notation`;
    }
    if (lo > hi) return `Range in {${body}} runs backwards`;
    if (max !== null && hi > max) return `Range in {${body}} exceeds what the token can show`;
    min = lo;
    max = hi;
  }
  // Letters and roman numerals have no zero.
  if (kind !== "N" && min < 1) return `Range in {${body}} must start at 1 or above`;
  return { type: "counter", kind, width, min, max };
}

export function parsePattern(source: string): ParsedPattern | { error: string } {
  const tokens: PatternToken[] = [];
  let literal = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "{" && source[i + 1] === "{") {
      literal += "{";
      i += 2;
    } else if (ch === "}" && source[i + 1] === "}") {
      literal += "}";
      i += 2;
    } else if (ch === "{") {
      const end = source.indexOf("}", i);
      if (end === -1) return { error: "Unclosed { in pattern" };
      const counter = parseCounter(source.slice(i + 1, end));
      if (typeof counter === "string") return { error: counter };
      if (literal) tokens.push({ type: "literal", text: literal });
      literal = "";
      tokens.push(counter);
      i = end + 1;
    } else if (ch === "}") {
      return { error: "Unmatched } in pattern (write }} for a literal brace)" };
    } else {
      literal += ch;
      i += 1;
    }
  }
  if (literal) tokens.push({ type: "literal", text: literal });

  const counters = tokens.filter((t): t is CounterToken => t.type === "counter");
  if (counters.length === 0) {
    return { error: "Pattern needs at least one counter such as {A}, {N} or {R}" };
  }

  for (let t = 1; t < tokens.length; t++) {
    const prev = tokens[t - 1];
    const cur = tokens[t];
    if (
      prev.type === "counter" &&
      cur.type === "counter" &&
      prev.width === null &&
      charClass(prev) === charClass(cur)
    ) {
      return {
        error:
          "Two adjacent counters use the same characters, so labels would be ambiguous — " +
          "separate them with literal text or zero-pad the first one",
      };
    }
  }

  const regex = new RegExp(
    "^" +
      tokens
        .map((t) => (t.type === "literal" ? escapeRegex(t.text) : tokenRegex(t)))
        .join("") +
      "$",
  );
  return { source, tokens, counters, regex };
}

// --- labels ---------------------------------------------------------------

export function formatLabel(pattern: ParsedPattern, values: number[]): string {
  let c = 0;
  return pattern.tokens
    .map((t) => (t.type === "literal" ? t.text : formatValue(t, values[c++])))
    .join("");
}

// The counter values a label spells, or null when it doesn't fit the pattern
// (wrong shape, non-canonical numeral, or outside a token's range).
export function parseLabel(pattern: ParsedPattern, label: string): number[] | null {
  const match = pattern.regex.exec(label);
  if (!match) return null;
  const values: number[] = [];
  for (let c = 0; c < pattern.counters.length; c++) {
    const token = pattern.counters[c];
    const value = parseValue(token.kind, match[c + 1]);
    if (value === null || value < token.min || (token.max !== null && value > token.max)) {
      return null;
    }
    values.push(value);
  }
  return values;
}

function compareValues(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// Odometer step: bump the last counter, rolling bounded counters over into
// the one before. Null once the first counter runs past its range.
function increment(pattern: ParsedPattern, values: number[]): number[] | null {
  const next = [...values];
  for (let c = next.length - 1; c >= 0; c--) {
    const token = pattern.counters[c];
    if (token.max === null || next[c] < token.max) {
      next[c] += 1;
      return next;
    }
    next[c] = token.min;
  }
  return null;
}

export function firstLabel(pattern: ParsedPattern): string {
  return formatLabel(
    pattern,
    pattern.counters.map((t) => t.min),
  );
}

/**
 * The label to suggest for a new sibling: one step past the highest existing
 * label that fits the pattern (so gaps left by deletions aren't refilled
 * behind the user's back), or the first label when there is none. Null when a
 * bounded pattern is exhausted.
 */
export function nextLabel(pattern: ParsedPattern, existing: string[]): string | null {
  let highest: number[] | null = null;
  for (const label of existing) {
    const values = parseLabel(pattern, label);
    if (values && (!highest || compareValues(values, highest) > 0)) highest = values;
  }
  if (!highest) return firstLabel(pattern);
  const next = increment(pattern, highest);
  return next ? formatLabel(pattern, next) : null;
}

/**
 * The first `count` labels of a pattern after the existing ones, for bulk
 * creation ("add 12 bins"). Stops early when the pattern is exhausted.
 */
export function nextLabels(
  pattern: ParsedPattern,
  existing: string[],
  count: number,
): string[] {
  const out: string[] = [];
  let current = nextLabel(pattern, existing);
  while (current !== null && out.length < count) {
    out.push(current);
    const values = parseLabel(pattern, current)!;
    const next = increment(pattern, values);
    current = next ? formatLabel(pattern, next) : null;
  }
  return out;
}

/**
 * Sort comparator for sibling labels: by counter values when both fit the
 * pattern (so "Bin IX" sorts before "Bin X" and "B2" before "B10"), with
 * labels that don't fit after them in natural string order.
 */
export function compareLabels(
  pattern: ParsedPattern | null,
  a: string,
  b: string,
): number {
  const va = pattern ? parseLabel(pattern, a) : null;
  const vb = pattern ? parseLabel(pattern, b) : null;
  if (va && vb) return compareValues(va, vb);
  if (va) return -1;
  if (vb) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Human description of a pattern, e.g. "letters, then 1–6". */
export function describePattern(pattern: ParsedPattern): string {
  const names: Record<TokenKind, string> = {
    A: "letters",
    a: "lowercase letters",
    N: "numbers",
    R: "roman numerals",
    r: "lowercase roman numerals",
  };
  return pattern.counters
    .map((t) => {
      // Roman numerals' implicit 3999 cap is not worth mentioning.
      const isRoman = t.kind === "R" || t.kind === "r";
      const bounded = t.max !== null && !(isRoman && t.max === ROMAN_MAX && t.min === 1);
      const range = bounded
        ? ` ${formatValue(t, t.min)}–${formatValue(t, t.max!)}`
        : "";
      return `${names[t.kind]}${range}`;
    })
    .join(", then ");
}

/** Common patterns, offered as one-click choices next to the pattern input. */
export const PATTERN_PRESETS = [
  { label: "Letters", pattern: "{A}" },
  { label: "Lowercase", pattern: "{a}" },
  { label: "Numbers", pattern: "{N}" },
  { label: "Roman", pattern: "{R}" },
  { label: "Padded", pattern: "{NN}" },
  { label: "Grid", pattern: "{A}{N:1-6}" },
];
