import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildableUnits,
  convertStock,
  deductsOnBuild,
  formatStock,
  isLowStock,
  levelLabel,
  parseLevel,
  STOCK_LEVELS,
  totalStock,
  parseQuantity,
  fromPickerValue,
  planConsumption,
  requirements,
  toPickerValue,
} from "@/lib/stock";

test("builds draw from the smallest stocks first to empty nearly-empty bins", () => {
  const plan = planConsumption(
    [
      { locationId: "big", quantity: 100 },
      { locationId: "small", quantity: 3 },
      { locationId: "empty", quantity: 0 },
    ],
    10,
  );
  assert.deepEqual(plan, [
    { locationId: "small", quantity: 3 },
    { locationId: "big", quantity: 7 },
  ]);
});

// Stock not put away yet (location null) is still on hand, so builds use it.
test("builds draw from unsorted stock like any bin", () => {
  assert.deepEqual(
    planConsumption(
      [
        { locationId: "bin", quantity: 10 },
        { locationId: null, quantity: 4 },
      ],
      6,
    ),
    [
      { locationId: null, quantity: 4 },
      { locationId: "bin", quantity: 2 },
    ],
  );
});

// Pickers use null for "nothing chosen", so unsorted travels as a sentinel
// and must come back as null before it reaches the stock actions.
test("unsorted round-trips through the picker value", () => {
  assert.equal(fromPickerValue(toPickerValue(null)), null);
  assert.equal(fromPickerValue(toPickerValue("loc-1")), "loc-1");
});

test("planConsumption refuses when the total is short — no partial builds", () => {
  assert.equal(planConsumption([{ locationId: "a", quantity: 4 }], 5), null);
});

test("buildable units are limited by the scarcest line", () => {
  assert.equal(
    buildableUnits([
      { partId: "screw", perUnit: 4, inStock: 30 }, // 7 units
      { partId: "insert", perUnit: 4, inStock: 9 }, // 2 units
    ]),
    2,
  );
  assert.equal(buildableUnits([]), 0, "an empty BOM builds nothing");
});

test("requirements report the shortfall per line", () => {
  const [line] = requirements([{ partId: "p", perUnit: 3, inStock: 5 }], 2);
  assert.equal(line.required, 6);
  assert.equal(line.shortfall, 1);
});

test("parseQuantity accepts whole numbers only", () => {
  assert.equal(parseQuantity("12"), 12);
  assert.equal(parseQuantity(" 3 "), 3);
  for (const bad of ["", "0", "-1", "1.5", "1e3", "abc"]) assert.equal(parseQuantity(bad), null, bad);
  assert.equal(parseQuantity("0", { allowZero: true }), 0, "stock counts may be set to zero");
});

test("low stock means strictly below the minimum; no minimum never alerts", () => {
  assert.equal(isLowStock(9, 10), true);
  assert.equal(isLowStock(10, 10), false);
  assert.equal(isLowStock(0, null), false);
});

// --- Tracking modes: bulk parts (screws, nuts) are kept as levels, not counts.

const { empty, low, plenty } = STOCK_LEVELS;

test("a part's total sums exact counts but takes the best level for level/binary parts", () => {
  assert.equal(totalStock("exact", [3, 4]), 7);
  // One full bin means it's on hand, however empty the others are.
  assert.equal(totalStock("level", [low, plenty, empty]), plenty);
  assert.equal(totalStock("binary", []), empty, "no locations = out of stock");
  assert.equal(totalStock("none", [5]), 0, "untracked parts hold no amount");
});

test("level/binary parts are low until some location is plenty; untracked never alert", () => {
  assert.equal(isLowStock(low, null, "level"), true);
  assert.equal(isLowStock(empty, null, "binary"), true);
  assert.equal(isLowStock(plenty, null, "level"), false);
  // The minimum is a count, so it only applies to exact parts.
  assert.equal(isLowStock(plenty, 50, "level"), false);
  assert.equal(isLowStock(0, 10, "none"), false);
});

test("builds only deduct exact parts; level parts limit a build only when empty", () => {
  assert.equal(deductsOnBuild("exact"), true);
  assert.equal(deductsOnBuild("level"), false);
  const lines = [
    { partId: "chip", perUnit: 1, inStock: 3 },
    { partId: "screw", perUnit: 8, inStock: low, tracking: "level" as const },
    { partId: "jig", perUnit: 1, inStock: 0, tracking: "none" as const },
  ];
  assert.equal(buildableUnits(lines), 3, "the counted chip decides, the low screws don't");
  const [, screws, jig] = requirements(lines, 10);
  assert.equal(screws.shortfall, 0);
  assert.equal(jig.shortfall, 0, "untracked parts are never short");
});

test("an empty level part blocks a build and lands on the shopping list in full", () => {
  const lines = [{ partId: "nut", perUnit: 4, inStock: empty, tracking: "binary" as const }];
  assert.equal(buildableUnits(lines), 0);
  assert.equal(requirements(lines, 2)[0].shortfall, 8);
});

test("a BOM of only uncounted parts reports no stock limit (null), not infinity", () => {
  assert.equal(buildableUnits([{ partId: "w", perUnit: 1, inStock: plenty, tracking: "level" }]), null);
});

test("switching to a level keeps what the count said; switching to exact starts at 0", () => {
  assert.equal(convertStock("exact", "level", 0, null), empty);
  assert.equal(convertStock("exact", "level", 3, 10), low, "below the minimum → low");
  assert.equal(convertStock("exact", "level", 3, null), plenty);
  assert.equal(convertStock("exact", "binary", 3, 10), plenty, "binary has no low");
  assert.equal(convertStock("level", "binary", low, null), plenty, "a low bin is still in stock");
  assert.equal(convertStock("binary", "level", plenty, null), plenty);
  // A level says nothing about how many, so the bins have to be counted.
  assert.equal(convertStock("level", "exact", plenty, null), 0);
  assert.equal(convertStock("exact", "none", 40, null), 0);
  assert.equal(convertStock("none", "level", 0, null), empty);
});

test("levels parse by value or label, only from the part's own choices", () => {
  assert.equal(parseLevel("level", "Low"), low);
  assert.equal(parseLevel("level", "2"), plenty);
  assert.equal(parseLevel("binary", "in stock"), plenty);
  assert.equal(parseLevel("binary", "low"), null, "binary parts have no low");
  assert.equal(parseLevel("exact", "0"), null);
});

test("stock is shown as a count, a level label, or a dash", () => {
  assert.equal(formatStock("exact", 12, "pcs"), "12 pcs");
  assert.equal(formatStock("level", low, "pcs"), "Low");
  assert.equal(formatStock("binary", plenty, "pcs"), "In stock");
  assert.equal(levelLabel("binary", low), "In stock", "a level carried over from level mode");
  assert.equal(formatStock("none", 0, "pcs"), "—");
});
