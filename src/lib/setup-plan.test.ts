import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_STRUCTURE,
  MAX_TOTAL,
  levelTotals,
  planLocations,
  prepareSetup,
  sampleVariables,
  validateSetup,
  type SetupLevel,
} from "@/lib/setup-plan";

const level = (over: Partial<SetupLevel>): SetupLevel => ({
  name: "Box",
  icon: "box",
  labelPattern: "{N}",
  template: 0,
  count: 1,
  ...over,
});

function valid(levels: SetupLevel[]) {
  const result = validateSetup(levels);
  if ("error" in result) assert.fail(result.error);
  return result.levels;
}

test("the example structure passes validation", () => {
  valid(EXAMPLE_STRUCTURE);
});

test("level names must be distinct ignoring case and whitespace", () => {
  // Types are told apart by name in every picker, so "Box" and " box" clash.
  const result = validateSetup([level({ name: "Box" }), level({ name: " box " })]);
  assert.ok("error" in result);
});

test("invalid patterns and empty names are rejected", () => {
  assert.ok("error" in validateSetup([level({ labelPattern: "{X}" })]));
  assert.ok("error" in validateSetup([level({ name: "  " })]));
  assert.ok("error" in validateSetup([]));
});

test("a count larger than a bounded pattern's labels is rejected", () => {
  // {N:1-4} has only four labels, so six siblings can't all be named.
  assert.ok("error" in validateSetup([level({ labelPattern: "{N:1-4}", count: 6 })]));
  valid([level({ labelPattern: "{N:1-4}", count: 4 })]);
});

test("the total across nested levels is capped", () => {
  // 20 × 20 × 20 = 8000 bins, far past the starting-tree cap.
  const result = validateSetup([
    level({ name: "A", count: 20 }),
    level({ name: "B", count: 20 }),
    level({ name: "C", count: 20 }),
  ]);
  assert.ok("error" in result);
  assert.match(result.error, new RegExp(String(MAX_TOTAL)));
});

test("unknown icons and templates fall back instead of failing", () => {
  const [only] = valid([level({ icon: "rocket", template: 99 })]);
  assert.equal(only.icon, "box");
  assert.equal(only.template, 0);
});

test("levelTotals multiplies counts down the hierarchy; a zero stops the chain", () => {
  assert.deepEqual(levelTotals([{ count: 2 }, { count: 3 }, { count: 4 }]), [2, 6, 24]);
  // No boxes means no parents for bins: they become a type only.
  assert.deepEqual(levelTotals([{ count: 2 }, { count: 0 }, { count: 4 }]), [2, 0, 0]);
});

test("planLocations nests each level's first labels under every parent", () => {
  const plan = planLocations(
    valid([
      level({ name: "Shelf", labelPattern: "{A}", count: 2 }),
      level({ name: "Bin", labelPattern: "{R}", count: 2 }),
    ]),
  );
  // Parents come before children so ids can be wired up in insert order.
  assert.deepEqual(plan, [
    { level: 0, label: "A", parent: null },
    { level: 0, label: "B", parent: null },
    { level: 1, label: "I", parent: 0 },
    { level: 1, label: "II", parent: 0 },
    { level: 1, label: "I", parent: 1 },
    { level: 1, label: "II", parent: 1 },
  ]);
});

test("planLocations creates nothing when the top level count is 0", () => {
  assert.deepEqual(planLocations(valid([level({ count: 0 }), level({ name: "Bin", count: 5 })])), []);
});

test("sampleVariables previews the first location of a level, ? for a broken pattern", () => {
  const vars = sampleVariables(EXAMPLE_STRUCTURE, 2, "https://x/locations/1");
  assert.equal(vars.code, "A/1/I");
  assert.equal(vars.type, "Bin");
  assert.equal(vars.parent, "A/1");
  const broken = [level({ labelPattern: "{A}" }), level({ name: "Bin", labelPattern: "{X}" })];
  assert.equal(sampleVariables(broken, 1, "").code, "A/?");
});

test("prepareSetup refuses a separator under which planned codes would repeat", () => {
  // Boxes {N} with bins {N} and no separator: box 1's bin 11 and box 11's bin 1 → "111".
  const numeric = [level({ name: "Box", count: 11 }), level({ name: "Bin", count: 11 })];
  assert.ok("error" in prepareSetup(numeric, ""));
  assert.ok("plan" in prepareSetup(numeric, "/"));
  // Alternating letters and numbers stays unambiguous without one: A1, A2 …
  const mixed = [level({ name: "Box", labelPattern: "{A}", count: 3 }), level({ name: "Bin", count: 11 })];
  assert.ok("plan" in prepareSetup(mixed, ""));
  assert.ok("error" in prepareSetup(mixed, "x"));
});

test("prepareSetup checks the grammar, not just the starting tree", () => {
  // Shelves {N:1-9} of boxes {N:1-9}: "12" is only ever 1 › 2, so no
  // separator is needed — but boxes up to 12 would let "112" mean 1 › 12 or
  // 11 › 2 once more shelves are added, even if the starting tree is small.
  const small = [
    level({ name: "Shelf", labelPattern: "{N:1-9}", count: 2 }),
    level({ name: "Box", labelPattern: "{N:1-9}", count: 2 }),
  ];
  assert.ok("plan" in prepareSetup(small, ""));
  const wide = [
    level({ name: "Shelf", labelPattern: "{N:1-12}", count: 2 }),
    level({ name: "Box", labelPattern: "{N:1-12}", count: 2 }),
  ];
  assert.ok("error" in prepareSetup(wide, ""));
});
