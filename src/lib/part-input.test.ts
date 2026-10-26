import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOrderUrls, parseOrderUrl, parseOrderUrls, parsePartInput, supplierName } from "@/lib/part-input";

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

test("order links are optional; blank entries are dropped", () => {
  const part = parsePartInput({ name: "x", orderUrls: ["  ", ""] });
  assert.ok(!("error" in part));
  assert.deepEqual(part.orderUrls, []);
  const none = parsePartInput({ name: "x" });
  assert.ok(!("error" in none) && none.orderUrls.length === 0);
});

// A part can be bought from several suppliers; the first link is the
// preferred one (the "Order" button), so order is kept and repeats dropped.
test("several order links keep their order, minus duplicates", () => {
  const part = parsePartInput({
    name: "x",
    orderUrls: ["lcsc.com/product-detail/C46749.html", "https://www.digikey.com/p/1", "https://lcsc.com/product-detail/C46749.html"],
  });
  assert.ok(!("error" in part));
  assert.deepEqual(part.orderUrls, ["https://lcsc.com/product-detail/C46749.html", "https://www.digikey.com/p/1"]);
});

// A spreadsheet cell holds several links on separate lines or split by ";".
test("a single string is split into links on whitespace and semicolons", () => {
  assert.deepEqual(parseOrderUrls("https://a.com/x\nb.com/y; https://c.com/z"), {
    urls: ["https://a.com/x", "https://b.com/y", "https://c.com/z"],
  });
});

test("one bad link rejects the whole list", () => {
  assert.ok("error" in parseOrderUrls(["https://a.com/x", "javascript:alert(1)"]));
  assert.ok("error" in parsePartInput({ name: "x", orderUrls: ["javascript:alert(1)"] }));
});

// Importing a second shop's order export adds that supplier without
// demoting the preferred (first) one.
test("mergeOrderUrls appends new links and keeps the existing order", () => {
  assert.deepEqual(mergeOrderUrls(["https://a.com/1", "https://b.com/2"], ["https://b.com/2", "https://c.com/3"]), [
    "https://a.com/1",
    "https://b.com/2",
    "https://c.com/3",
  ]);
});

test("supplierName labels a link by its host", () => {
  assert.equal(supplierName("https://www.digikey.com/en/products/x"), "digikey.com");
  assert.equal(supplierName("https://lcsc.com/product-detail/C1.html"), "lcsc.com");
});

test("order link without a scheme gets https:// (people paste 'lcsc.com/…')", () => {
  assert.equal(parseOrderUrl("lcsc.com/product-detail/C123.html"), "https://lcsc.com/product-detail/C123.html");
  assert.equal(parseOrderUrl("http://shop.example.com/x"), "http://shop.example.com/x");
});

test("order link must be http(s) — it is rendered as an href", () => {
  assert.equal(parseOrderUrl("javascript:alert(1)"), null);
  assert.equal(parseOrderUrl("ftp://example.com/x"), null);
  assert.equal(parseOrderUrl("not a url"), null);
});

// The icon comes from the catalogue picker and ends up in a URL path, so
// anything not shaped like a catalogue id is dropped, not stored.
test("icon keeps a catalogue id and drops anything else", () => {
  const parse = (icon: unknown) => {
    const input = parsePartInput({ name: "M3 nut", icon });
    assert.ok(!("error" in input));
    return input.icon;
  };
  assert.equal(parse("screw/hardware/nuts/hex-nut"), "screw/hardware/nuts/hex-nut");
  assert.equal(parse(undefined), "");
  for (const bad of ["hex-nut", "../etc/passwd", "screw/../x", "screw/Nut", "screw//nut", "https://x.y/a"]) {
    assert.equal(parse(bad), "", bad);
  }
});
