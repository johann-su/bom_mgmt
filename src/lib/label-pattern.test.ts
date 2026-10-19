import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareLabels,
  describePattern,
  fromRoman,
  nextLabel,
  nextLabels,
  parseLabel,
  parsePattern,
  type ParsedPattern,
} from "@/lib/label-pattern";

function pattern(source: string): ParsedPattern {
  const parsed = parsePattern(source);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

test("the README example: alpha shelves, numeric boxes, roman bins", () => {
  assert.equal(nextLabel(pattern("{A}"), []), "A");
  assert.equal(nextLabel(pattern("{N}"), []), "1");
  assert.equal(nextLabel(pattern("{R}"), []), "I");
  assert.equal(nextLabel(pattern("{R}"), ["I", "II", "III"]), "IV");
});

test("letters continue past Z bijectively (Z → AA, AZ → BA)", () => {
  const p = pattern("{A}");
  assert.equal(nextLabel(p, ["Z"]), "AA");
  assert.equal(nextLabel(p, ["AZ"]), "BA");
  assert.equal(nextLabel(pattern("{a}"), ["z"]), "aa");
});

test("bounded counters roll over like an odometer — alpha-numeric grids", () => {
  const p = pattern("{A}{N:1-3}");
  assert.deepEqual(nextLabels(p, [], 5), ["A1", "A2", "A3", "B1", "B2"]);
});

test("a fully bounded pattern runs out instead of wrapping around", () => {
  const p = pattern("{A:A-B}{N:1-2}");
  assert.equal(nextLabel(p, ["B2"]), null);
  assert.deepEqual(nextLabels(p, ["A2"], 10), ["B1", "B2"]);
});

test("zero-padded {NN} has a fixed width and an implicit 99 cap", () => {
  const p = pattern("S-{NN}");
  assert.equal(nextLabel(p, []), "S-01");
  assert.equal(nextLabel(p, ["S-09"]), "S-10");
  assert.equal(nextLabel(p, ["S-99"]), null);
  assert.equal(parseLabel(p, "S-1"), null, "unpadded spelling is not the same slot");
});

test("next label follows the highest existing one, not the first gap", () => {
  // A deleted bin's slot is not silently reused for a new bin.
  assert.equal(nextLabel(pattern("{N}"), ["1", "3"]), "4");
});

test("labels that don't fit the pattern are ignored when suggesting", () => {
  assert.equal(nextLabel(pattern("{N}"), ["spare", "2"]), "3");
});

test("parseLabel rejects non-canonical spellings so siblings stay unique", () => {
  assert.equal(parseLabel(pattern("{R}"), "IIII"), null);
  assert.equal(parseLabel(pattern("{N}"), "007"), null);
  assert.equal(parseLabel(pattern("{A}"), "a"), null, "case is part of the pattern");
  assert.deepEqual(parseLabel(pattern("Box {N}"), "Box 12"), [12]);
});

test("ranges are enforced on validation", () => {
  const p = pattern("{N:0-9}");
  assert.deepEqual(parseLabel(p, "0"), [0]);
  assert.equal(parseLabel(p, "10"), null);
  assert.equal(parseLabel(pattern("{A:A-F}"), "G"), null);
});

test("roman numerals parse only in canonical form", () => {
  assert.equal(fromRoman("XIV"), 14);
  assert.equal(fromRoman("MCMXCIV"), 1994);
  assert.equal(fromRoman("IC"), null);
  assert.equal(fromRoman("VV"), null);
});

test("invalid patterns are rejected with a reason", () => {
  for (const bad of [
    "Shelf", // no counter
    "{X}", // unknown token
    "{N", // unclosed
    "{N:5-1}", // backwards range
    "{N}{N}", // ambiguous: is "123" 1|23 or 12|3?
    "{A}{R}", // both uppercase letters
    "{NN:1-100}", // range wider than two digits
  ]) {
    assert.ok("error" in parsePattern(bad), `expected ${bad} to be rejected`);
  }
});

test("adjacent counters are fine when their characters differ or the first is padded", () => {
  assert.ok(!("error" in parsePattern("{A}{N}")));
  assert.ok(!("error" in parsePattern("{NN}{N}")));
  assert.deepEqual(parseLabel(pattern("{NN}{N}"), "0312"), [3, 12]);
});

test("literal braces are written doubled", () => {
  const p = pattern("{{{N}}}");
  assert.equal(nextLabel(p, []), "{1}");
});

test("compareLabels sorts by counter value, misfits last", () => {
  const p = pattern("{R}");
  assert.deepEqual(
    ["X", "spare", "IX", "II"].sort((a, b) => compareLabels(p, a, b)),
    ["II", "IX", "X", "spare"],
  );
  // Without a pattern, natural order still puts 2 before 10.
  assert.deepEqual(["10", "2"].sort((a, b) => compareLabels(null, a, b)), ["2", "10"]);
});

test("describePattern names counters and explicit ranges", () => {
  assert.equal(describePattern(pattern("{A}{N:1-6}")), "letters, then numbers 1–6");
  assert.equal(describePattern(pattern("{R}")), "roman numerals");
});
