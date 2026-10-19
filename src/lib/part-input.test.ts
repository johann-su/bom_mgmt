import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePartInput } from "@/lib/part-input";

test("a name is the only required field; the rest gets defaults", () => {
  const part = parsePartInput({ name: "  Heat-set insert M3x5 " });
  assert.ok(!("error" in part));
  assert.equal(part.name, "Heat-set insert M3x5");
  assert.equal(part.unit, "pcs");
  assert.equal(part.minStock, null, "blank minimum = low stock not tracked");
  assert.equal(part.categoryId, null);
});

test("missing name is rejected", () => {
  assert.ok("error" in parsePartInput({ name: "   " }));
});

test("minimum stock must be a whole number when given", () => {
  assert.ok("error" in parsePartInput({ name: "x", minStock: "2.5" }));
  assert.ok("error" in parsePartInput({ name: "x", minStock: "-1" }));
  const part = parsePartInput({ name: "x", minStock: "0" });
  assert.ok(!("error" in part) && part.minStock === 0);
});

test("the select's 'none' sentinel means no category", () => {
  const part = parsePartInput({ name: "x", categoryId: "none" });
  assert.ok(!("error" in part) && part.categoryId === null);
});
