import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrderUrl, parsePartInput } from "@/lib/part-input";

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

test("order link is optional; blank means no link", () => {
  const part = parsePartInput({ name: "x", orderUrl: "  " });
  assert.ok(!("error" in part) && part.orderUrl === "");
});

test("order link without a scheme gets https:// (people paste 'lcsc.com/…')", () => {
  assert.equal(parseOrderUrl("lcsc.com/product-detail/C123.html"), "https://lcsc.com/product-detail/C123.html");
  assert.equal(parseOrderUrl("http://shop.example.com/x"), "http://shop.example.com/x");
});

test("order link must be http(s) — it is rendered as an href", () => {
  assert.equal(parseOrderUrl("javascript:alert(1)"), null);
  assert.equal(parseOrderUrl("ftp://example.com/x"), null);
  assert.equal(parseOrderUrl("not a url"), null);
  assert.ok("error" in parsePartInput({ name: "x", orderUrl: "javascript:alert(1)" }));
});
