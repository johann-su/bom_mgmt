import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildableUnits,
  isLowStock,
  parseQuantity,
  planConsumption,
  requirements,
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
