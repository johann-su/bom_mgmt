import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowsChild,
  describeAmbiguity,
  findAmbiguity,
  grammarViolations,
  observedChildTypes,
  type GrammarType,
} from "@/lib/code-grammar";

const type = (id: string, labelPattern: string, childTypeIds: string[] | null = null): GrammarType => ({
  id,
  name: id,
  labelPattern,
  childTypeIds,
});

// Every reading must spell the witness code, or the witness is made up.
function assertWitness(types: GrammarType[], separator: string) {
  const found = findAmbiguity(types, separator);
  assert.ok(found, "expected an ambiguity");
  const [a, b] = found.readings;
  for (const reading of [a, b]) {
    assert.equal(reading.map((r) => r.label).join(separator), found.code);
  }
  assert.notDeepEqual(
    a.map((r) => r.label),
    b.map((r) => r.label),
  );
  return found;
}

test("a separator no pattern contains makes any grammar unambiguous", () => {
  // Free nesting, unbounded patterns: the separator alone marks every split.
  const types = [type("Shelf", "{N}"), type("Box", "{A}"), type("Bin", "{N}")];
  assert.equal(findAmbiguity(types, "/"), null);
});

test("without a separator, free nesting of an unbounded counter is ambiguous (1›11 vs 11›1)", () => {
  const found = assertWitness([type("Shelf", "{N}")], "");
  // BFS finds the shortest witness: Shelf 1 › Shelf 1 vs Shelf 11.
  assert.equal(found.code, "11");
  assert.match(describeAmbiguity(found), /Shelf 11/);
});

test("without a separator, a grammar that switches character class at each level is unambiguous", () => {
  // The intended no-separator scheme: 1Ac — digits › upper › lower.
  const types = [
    type("Shelf", "{N}", ["Box"]),
    type("Box", "{A}", ["Bin"]),
    type("Bin", "{a}", []),
  ];
  assert.equal(findAmbiguity(types, ""), null);
});

test("the grammar matters: allowing Shelf › Filament Box (digits › digits) breaks it", () => {
  const types = [
    type("Shelf", "{N}", ["Box", "Filament"]),
    type("Box", "{A}", []),
    type("Filament", "{N}", []),
  ];
  const found = assertWitness(types, "");
  // One reading is two levels deep (Shelf › Filament); the other is a single
  // two-digit label — any type may also sit at the top level.
  const depths = found.readings.map((r) => r.length).sort();
  assert.deepEqual(depths, [1, 2]);
});

test("bounded ranges are exact: single-digit shelves of single-digit boxes are fine", () => {
  // {N:1-9} › {N:1-9}: "12" can only be 1 › 2. A class-based check would refuse this.
  const types = [type("Shelf", "{N:1-9}", ["Box"]), type("Box", "{N:1-9}", [])];
  assert.equal(findAmbiguity(types, ""), null);
  // …but with two-digit boxes, "112" is 1 › 12 or 11 › 2 once shelves reach 11.
  const wider = [type("Shelf", "{N:1-12}", ["Box"]), type("Box", "{N:1-12}", [])];
  assertWitness(wider, "");
});

test("a separator that also appears in a pattern's literal text is ambiguous", () => {
  // With "-": Shelf 1 › Box 2-3 and Box 1-2 › Shelf 3 are both "1-2-3".
  const types = [type("Shelf", "{N}"), type("Box", "{N}-{N}")];
  assertWitness(types, "-");
  // The same patterns are fine once the separator can't occur in a label.
  assert.equal(findAmbiguity(types, "/"), null);
});

test("zero-padded counters are fixed width, so they split cleanly even without a separator", () => {
  const types = [type("Shelf", "{NN}", ["Box"]), type("Box", "{NN}", [])];
  assert.equal(findAmbiguity(types, ""), null);
});

test("types with invalid patterns are ignored rather than crashing the check", () => {
  assert.equal(findAmbiguity([type("Broken", "{Q}"), type("Box", "{A}", [])], ""), null);
});

test("allowsChild: null means any type, a list restricts", () => {
  assert.equal(allowsChild({ childTypeIds: null }, "x"), true);
  assert.equal(allowsChild({ childTypeIds: ["y"] }, "x"), false);
});

const loc = (id: string, parentId: string | null, typeId: string) => ({
  id,
  parentId,
  type: { id: typeId, name: typeId },
});

test("observedChildTypes collects each type's actual child types", () => {
  const observed = observedChildTypes([
    loc("s1", null, "Shelf"),
    loc("b1", "s1", "Box"),
    loc("d1", "s1", "Drawer"),
    loc("i1", "b1", "Bin"),
  ]);
  assert.deepEqual(observed.get("Shelf")?.sort(), ["Box", "Drawer"]);
  assert.deepEqual(observed.get("Box"), ["Bin"]);
  assert.equal(observed.has("Bin"), false);
});

test("grammarViolations lists existing parent › child pairs the grammar forbids", () => {
  const locations = [loc("s1", null, "Shelf"), loc("b1", "s1", "Box"), loc("i1", "s1", "Bin")];
  const types = [type("Shelf", "{N}", ["Box"]), type("Box", "{A}"), type("Bin", "{a}")];
  assert.deepEqual(grammarViolations(locations, types), ["Shelf › Bin"]);
});
