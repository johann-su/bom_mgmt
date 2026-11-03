import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePartInput } from "@/lib/part-input";
import { CreatePartBody, StockChangeBody, StockMoveBody, UpdatePartBody } from "@/lib/api/schemas";
import {
  createPartValues,
  levelValue,
  resolveLocationRef,
  resolvePlace,
  stockChangeInput,
  stockMoveInput,
  updatePartValues,
  type StoredPart,
} from "@/lib/api/translate";

const current: StoredPart = {
  name: "NE555 timer",
  description: "Classic",
  categoryId: "1b5e7d3a-8d0e-4b9e-9a51-2f6f0c1d2e3f",
  manufacturer: "TI",
  mpn: "NE555P",
  unit: "pcs",
  tracking: "exact",
  minStock: 10,
  orderUrls: ["https://lcsc.com/product-detail/C46749.html"],
  icon: "",
  attributes: [{ key: "Package", value: "DIP-8" }],
  generic: { family: "fasteners", type: "socket-cap", values: { size: "M3" } } as unknown as StoredPart["generic"],
  notes: "Drawer 3",
};

// The core's update replaces every field with the full form; a PATCH that
// names one field must not wipe the others (the classic partial-update bug).
test("a PATCH keeps every field it doesn't mention", () => {
  const values = updatePartValues(current, UpdatePartBody.parse({ name: "NE555 timer (TI)" }), undefined);
  assert.equal(values.name, "NE555 timer (TI)");
  assert.equal(values.description, current.description);
  assert.equal(values.categoryId, current.categoryId);
  assert.equal(values.minStock, "10");
  assert.deepEqual(values.orderUrls, current.orderUrls);
  assert.deepEqual(values.attributes, current.attributes);
  // And what it produces is still a valid part form.
  assert.ok(!("error" in parsePartInput(values)));
});

// The generic-part wizard's stored choice isn't API-editable; a PATCH must
// carry it along or "Edit generic part" would stop working on the part.
test("a PATCH can't drop the generic-part choice", () => {
  assert.deepEqual(updatePartValues(current, UpdatePartBody.parse({ notes: "" }), undefined).generic, current.generic);
});

// null is a value ("no category", "no minimum"); only an absent key keeps it.
test("null clears category and minStock, absent keeps them", () => {
  const cleared = updatePartValues(current, UpdatePartBody.parse({ minStock: null }), null);
  assert.equal(cleared.categoryId, "");
  assert.equal(cleared.minStock, "");
  const kept = updatePartValues(current, UpdatePartBody.parse({}), undefined);
  assert.equal(kept.categoryId, current.categoryId);
});

// Lists are replaced whole, as JSON merge-patch does — unlike the MCP tool,
// which merges attributes for an LLM's convenience.
test("attributes and orderUrls in a PATCH replace the lists", () => {
  const values = updatePartValues(
    current,
    UpdatePartBody.parse({ attributes: [{ key: "Supply", value: "4.5–16 V" }], orderUrls: [] }),
    undefined,
  );
  assert.deepEqual(values.attributes, [{ key: "Supply", value: "4.5–16 V" }]);
  assert.deepEqual(values.orderUrls, []);
});

test("unknown fields and a category given twice are rejected", () => {
  assert.equal(UpdatePartBody.safeParse({ nmae: "typo" }).success, false);
  assert.equal(
    CreatePartBody.safeParse({ name: "x", categoryId: current.categoryId, categoryName: "ICs" }).success,
    false,
  );
});

test("an icon must come from the label-icon catalogue", () => {
  assert.equal(UpdatePartBody.safeParse({ icon: "javascript:alert(1)" }).success, false);
  assert.equal(UpdatePartBody.safeParse({ icon: "" }).success, true);
});

// Initial stock has to fit the tracking mode — the core would quietly ignore
// a level on a counted part, so the API refuses it instead.
test("initial stock is a quantity for exact parts and a level for level parts", () => {
  const exact = createPartValues(CreatePartBody.parse({ name: "R 10k", stock: { location: null, quantity: 100 } }), {
    categoryId: null,
    stockLocationId: null,
  });
  assert.ok("values" in exact);
  assert.equal(exact.values.initialQuantity, "100");
  assert.equal(exact.values.tracking, "exact");

  const level = createPartValues(
    CreatePartBody.parse({ name: "M3 nut", tracking: "level", stock: { location: "A/1", level: "plenty" } }),
    { categoryId: null, stockLocationId: "loc-1" },
  );
  assert.ok("values" in level);
  assert.equal(level.values.initialQuantity, "2");
  assert.equal(level.values.initialLocationId, "loc-1");

  assert.ok("error" in createPartValues(CreatePartBody.parse({ name: "x", stock: { location: null, level: "low" } }), { categoryId: null, stockLocationId: null }));
  assert.ok("error" in createPartValues(CreatePartBody.parse({ name: "x", tracking: "none", stock: { location: "A", quantity: 1 } }), { categoryId: null, stockLocationId: "a" }));
});

// Defaults fill what a create body leaves out, the way the form would.
test("a minimal create body is a valid part", () => {
  const created = createPartValues(CreatePartBody.parse({ name: "Mystery part" }), { categoryId: null, stockLocationId: null });
  assert.ok("values" in created);
  const parsed = parsePartInput(created.values);
  assert.ok(!("error" in parsed));
  assert.equal(parsed.unit, "pcs");
  assert.equal(parsed.categoryId, null);
});

// Level names map onto the shared stored scale; binary parts have no "low".
test("levels by name: binary parts are empty or plenty", () => {
  assert.deepEqual(levelValue("level", "low"), { value: 1 });
  assert.deepEqual(levelValue("binary", "plenty"), { value: 2 });
  assert.ok("error" in levelValue("binary", "low"));
  assert.ok("error" in levelValue("exact", "plenty"));
});

const locations = [
  { id: "a0000000-0000-4000-8000-000000000001", code: "A/1/IV" },
  { id: "a0000000-0000-4000-8000-000000000002", code: "A/1/V" },
];

test("locations are found by id or code, case-insensitively as a fallback", () => {
  const byId = resolveLocationRef(locations, locations[1].id);
  assert.ok("location" in byId && byId.location.code === "A/1/V");
  const byCode = resolveLocationRef(locations, "a/1/iv");
  assert.ok("location" in byCode && byCode.location.id === locations[0].id);
  assert.ok("error" in resolveLocationRef(locations, "B/7"));
});

// Two codes differing only in case can't be told apart by a folded match.
test("a case-folded code that matches two locations is ambiguous", () => {
  const twins = [
    { id: "1", code: "A/iv" },
    { id: "2", code: "A/IV" },
  ];
  assert.ok("error" in resolveLocationRef(twins, "a/Iv"));
  const exact = resolveLocationRef(twins, "A/IV");
  assert.ok("location" in exact && exact.location.id === "2");
});

test("a null place is the unsorted pile; an unknown one names the field", () => {
  assert.deepEqual(resolvePlace(locations, null, "from"), { id: null });
  const unknown = resolvePlace(locations, "Z/9", "to");
  assert.ok("error" in unknown && unknown.error.startsWith("to:"));
});

test("a level booking stores the level's value", () => {
  const change = stockChangeInput(
    { id: "p1", tracking: "level" },
    StockChangeBody.parse({ mode: "level", location: "A/1/IV", level: "low", note: "running out" }),
    locations[0].id,
  );
  assert.ok("input" in change);
  assert.deepEqual(change.input, { partId: "p1", locationId: locations[0].id, mode: "level", quantity: "1", note: "running out" });
});

// Each stock mode takes exactly its own fields.
test("stock bodies are strict per mode", () => {
  assert.equal(StockChangeBody.safeParse({ mode: "add", location: null }).success, false);
  assert.equal(StockChangeBody.safeParse({ mode: "remove", location: null, quantity: 0 }).success, false);
  assert.equal(StockChangeBody.safeParse({ mode: "set", location: null, quantity: 0 }).success, true);
  assert.equal(StockChangeBody.safeParse({ mode: "place", location: null }).success, false);
  assert.equal(StockChangeBody.safeParse({ mode: "level", location: null, level: "plenty", quantity: 3 }).success, false);
});

// A level part can't be split: moving "3" of it would silently move all.
test("moves need a quantity for counted parts and refuse one for the rest", () => {
  const places = { from: null, to: locations[0].id };
  assert.ok("error" in stockMoveInput({ id: "p", tracking: "exact" }, StockMoveBody.parse({ from: null, to: "A/1/IV" }), places));
  assert.ok("error" in stockMoveInput({ id: "p", tracking: "level" }, StockMoveBody.parse({ from: null, to: "A/1/IV", quantity: 3 }), places));
  const whole = stockMoveInput({ id: "p", tracking: "binary" }, StockMoveBody.parse({ from: null, to: "A/1/IV" }), places);
  assert.ok("input" in whole && whole.input.quantity === "");
});
