import { test } from "node:test";
import assert from "node:assert/strict";
import { InvalidParamsError, ToolError } from "@/lib/mcp/protocol";
import {
  importRowsToTable,
  partFormValues,
  readAttributes,
  resolveLocation,
  resolveStockPlace,
  type StoredPart,
} from "@/lib/mcp/tool-input";
import { parsePartInput } from "@/lib/part-input";
import { partTableFromRows, planPartImport } from "@/lib/part-csv";

const LOCATIONS = [
  { id: "loc-a", code: "A", path: "Shelf A" },
  { id: "loc-a1", code: "A/1", path: "Shelf A / Box 1" },
  { id: "loc-a1iv", code: "A/1/IV", path: "Shelf A / Box 1 / Bin IV" },
];

// Models address locations the way the labels read, by code — or by the
// path they saw in a tool result, or by id.
test("resolveLocation finds a location by id, code, or path, ignoring case", () => {
  assert.equal(resolveLocation(LOCATIONS, "loc-a1").id, "loc-a1");
  assert.equal(resolveLocation(LOCATIONS, "A/1/IV").id, "loc-a1iv");
  assert.equal(resolveLocation(LOCATIONS, " a/1/iv ").id, "loc-a1iv");
  assert.equal(resolveLocation(LOCATIONS, "shelf a / box 1").id, "loc-a1");
});

// An unknown code must come back as something the model can act on (a
// ToolError listing real codes), not a protocol fault.
test("resolveLocation rejects an unknown location with codes to pick from", () => {
  assert.throws(
    () => resolveLocation(LOCATIONS, "Z/9"),
    (err) => err instanceof ToolError && /A\/1/.test(err.message),
  );
});

// "unsorted" is the pile of stock not put away yet (null) — but a real
// location with that code is what the user means, so it wins.
test("resolveStockPlace maps \"unsorted\" to null unless a location has that code", () => {
  assert.equal(resolveStockPlace(LOCATIONS, "Unsorted"), null);
  assert.equal(resolveStockPlace(LOCATIONS, "A/1"), "loc-a1");
  const named = [...LOCATIONS, { id: "loc-u", code: "UNSORTED", path: "Unsorted" }];
  assert.equal(resolveStockPlace(named, "unsorted"), "loc-u");
  assert.throws(() => resolveStockPlace(LOCATIONS, "Z/9"), ToolError);
});

test("readAttributes accepts a {key, value} list or a plain object", () => {
  assert.deepEqual(readAttributes({ Package: "DIP-8", Pins: 8 }), [
    { key: "Package", value: "DIP-8" },
    { key: "Pins", value: "8" },
  ]);
  assert.deepEqual(readAttributes([{ key: "Thread", value: "M3" }]), [{ key: "Thread", value: "M3" }]);
  assert.deepEqual(readAttributes(undefined), []);
  assert.throws(() => readAttributes("Package=DIP-8"), InvalidParamsError);
});

const STORED: StoredPart = {
  name: "NE555 timer",
  description: "Single timer, DIP-8",
  categoryId: "cat-ics",
  manufacturer: "TI",
  mpn: "NE555P",
  unit: "pcs",
  minStock: 5,
  orderUrl: "https://www.lcsc.com/product-detail/C46749.html",
  attributes: [
    { key: "Package", value: "DIP-8" },
    { key: "Supply", value: "4.5–16 V" },
  ],
  notes: "",
};

// update_part is a patch: anything the model didn't mention must survive,
// and the result must still pass the part form's own validation.
test("partFormValues changes only the patched fields", () => {
  const values = partFormValues(STORED, { minStock: 10, notes: "Reorder from LCSC" });
  const parsed = parsePartInput(values);
  assert.ok(!("error" in parsed));
  assert.equal(parsed.minStock, 10);
  assert.equal(parsed.notes, "Reorder from LCSC");
  assert.equal(parsed.description, STORED.description);
  assert.equal(parsed.categoryId, "cat-ics");
  assert.deepEqual(parsed.attributes, STORED.attributes);
});

// null is how the model says "clear it" — distinct from leaving it out.
test("partFormValues clears minStock and category on null", () => {
  const parsed = parsePartInput(partFormValues(STORED, { minStock: null, categoryId: null }));
  assert.ok(!("error" in parsed));
  assert.equal(parsed.minStock, null);
  assert.equal(parsed.categoryId, null);
});

// Attributes merge by key (so "set the package" doesn't erase the supply
// range); removal is an explicit, separate list.
test("partFormValues merges attributes by key and removes the listed ones", () => {
  const parsed = parsePartInput(
    partFormValues(STORED, {
      attributes: [
        { key: "package", value: "SOIC-8" },
        { key: "Temp", value: "0–70 °C" },
      ],
      removeAttributes: ["SUPPLY"],
    }),
  );
  assert.ok(!("error" in parsed));
  assert.deepEqual(parsed.attributes, [
    { key: "Package", value: "SOIC-8" },
    { key: "Temp", value: "0–70 °C" },
  ]);
});

// A structured import must go through the same planner as an uploaded file,
// so matching (MPN → existing part), location lookup and attribute columns
// behave identically. Checked by planning the generated table for real.
test("importRowsToTable builds a table the import planner reads like a CSV", () => {
  const { rows, mapping } = importRowsToTable([
    { mpn: "NE555P", quantity: 20, location: "A/1" },
    { name: "M3x8 screw", category: "Fasteners", attributes: { Thread: "M3", Length: "8 mm" } },
  ]);
  const plan = planPartImport(partTableFromRows(rows), mapping, {
    parts: [{ id: "part-555", name: "NE555 timer", mpn: "NE555P" }],
    locations: LOCATIONS,
  });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.rows[0].target, { existing: "part-555" });
  assert.deepEqual(plan.rows[0].stock, { locationId: "loc-a1", quantity: 20 });
  assert.equal(plan.rows[1].values.category, "Fasteners");
  assert.deepEqual(plan.rows[1].values.attributes, [
    { key: "Thread", value: "M3" },
    { key: "Length", value: "8 mm" },
  ]);
});

// A typo like "qty" would otherwise drop every quantity without a word.
test("importRowsToTable rejects unknown fields", () => {
  assert.throws(() => importRowsToTable([{ name: "x", qty: 5 }]), InvalidParamsError);
});
