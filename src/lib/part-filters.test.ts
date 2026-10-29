import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileFilters,
  findFilter,
  parseFilter,
  parseFilterParams,
  serializeFilter,
  stockStatus,
  toggleFilterValue,
  type FilterablePart,
  type PartFilter,
} from "@/lib/part-filters";

function part(over: Partial<FilterablePart> = {}): FilterablePart {
  return {
    categoryId: null,
    manufacturer: "",
    tracking: "exact",
    total: 10,
    minStock: null,
    attributes: [],
    locationIds: [],
    unsorted: false,
    ...over,
  };
}

const noSubtree = (id: string) => [id];
const matches = (filters: PartFilter[], p: FilterablePart, subtree = noSubtree) =>
  compileFilters(filters, subtree)(p);

test("stockStatus: empty means a tracked part with nothing left; untracked parts are never empty", () => {
  assert.equal(stockStatus({ tracking: "exact", total: 0, minStock: null }), "empty");
  assert.equal(stockStatus({ tracking: "exact", total: 3, minStock: 5 }), "low");
  assert.equal(stockStatus({ tracking: "exact", total: 3, minStock: null }), "plenty");
  assert.equal(stockStatus({ tracking: "level", total: 1, minStock: null }), "low");
  assert.equal(stockStatus({ tracking: "binary", total: 0, minStock: null }), "empty");
  assert.equal(stockStatus({ tracking: "none", total: 0, minStock: null }), "untracked");
});

test("filters round-trip through the URL format, including awkward attribute text", () => {
  const filters: PartFilter[] = [
    { field: "stock", negate: false, values: ["empty", "low"] },
    { field: "category", negate: true, values: [""] },
    { field: "attr", negate: false, key: "Thread: pitch", values: ["M3, fine", "50%"] },
    { field: "attr", negate: true, key: "Drive", values: [] },
    { field: "attr", negate: false, key: "Drive~ish", values: [], contains: "hex: 2,5~" },
    { field: "unsorted", negate: false, values: [] },
  ];
  for (const f of filters) assert.deepEqual(parseFilter(serializeFilter(f)), f);
});

test("parseFilter drops what it can't use instead of matching nothing", () => {
  assert.equal(parseFilter("price:5"), null, "unknown field");
  assert.equal(parseFilter("stock:full"), null, "unknown stock status leaves no values");
  assert.equal(parseFilter("attr:Hex"), null, "attribute without a key");
  assert.equal(parseFilter("location:%E0%A4%A"), null, "broken percent-encoding");
  assert.deepEqual(parseFilter("stock:full,empty"), { field: "stock", negate: false, values: ["empty"] });
});

test("legacy params (?low=1, ?category=, ?unsorted=1) still filter, so old links keep working", () => {
  assert.deepEqual(parseFilterParams({ low: "1", category: "c1", unsorted: "1", f: "attr.Drive:Hex" }), [
    { field: "attr", negate: false, key: "Drive", values: ["Hex"] },
    { field: "category", negate: false, values: ["c1"] },
    { field: "stock", negate: false, values: ["empty", "low"] },
    { field: "unsorted", negate: false, values: [] },
  ]);
});

test("all filters must hold; values within one filter are alternatives", () => {
  const filters: PartFilter[] = [
    { field: "category", negate: false, values: ["fasteners", "connectors"] },
    { field: "stock", negate: false, values: ["empty"] },
  ];
  assert.equal(matches(filters, part({ categoryId: "connectors", total: 0 })), true);
  assert.equal(matches(filters, part({ categoryId: "connectors", total: 4 })), false);
  assert.equal(matches(filters, part({ categoryId: "passives", total: 0 })), false);
});

test("attribute filters: key and value compare case-insensitively; a part without the key never 'is' a value", () => {
  const hex = part({ attributes: [{ key: "Drive", value: "Hex" }] });
  const torx = part({ attributes: [{ key: "drive", value: "Torx T10" }] });
  const none = part();
  const isHex: PartFilter[] = [{ field: "attr", negate: false, key: "drive", values: ["hex"] }];
  const hasDrive: PartFilter[] = [{ field: "attr", negate: false, key: "DRIVE", values: [] }];
  const notHex: PartFilter[] = [{ field: "attr", negate: true, key: "Drive", values: ["Hex"] }];
  assert.deepEqual(
    [hex, torx, none].map((p) => matches(isHex, p)),
    [true, false, false],
  );
  assert.deepEqual(
    [hex, torx, none].map((p) => matches(hasDrive, p)),
    [true, true, false],
  );
  // "is not Hex" includes parts with no Drive at all — the negation is literal.
  assert.deepEqual(
    [hex, torx, none].map((p) => matches(notHex, p)),
    [false, true, true],
  );
});

test("attribute 'contains' matches a word inside longer values, e.g. Drive contains hex", () => {
  const f: PartFilter[] = [{ field: "attr", negate: false, key: "Drive", values: [], contains: "hex" }];
  assert.equal(matches(f, part({ attributes: [{ key: "Drive", value: "Hex socket 2.5 mm" }] })), true);
  assert.equal(matches(f, part({ attributes: [{ key: "Drive", value: "Torx T10" }] })), false);
  assert.equal(matches(f, part()), false);
  assert.deepEqual(parseFilter("attr.Drive~hex"), f[0]);
});

test("a location filter matches parts anywhere inside it, empty bins included", () => {
  const box = (id: string) => (id === "box" ? ["box", "bin1", "bin2"] : [id]);
  const inBox: PartFilter[] = [{ field: "location", negate: false, values: ["box"] }];
  assert.equal(matches(inBox, part({ locationIds: ["bin2"], total: 0 }), box), true);
  assert.equal(matches(inBox, part({ locationIds: ["shelf"] }), box), false);
  const notInBox: PartFilter[] = [{ ...inBox[0], negate: true }];
  assert.equal(matches(notInBox, part({ locationIds: ["bin1"] }), box), false);
});

test("category '' stands for uncategorised", () => {
  const f: PartFilter[] = [{ field: "category", negate: false, values: [""] }];
  assert.equal(matches(f, part({ categoryId: null })), true);
  assert.equal(matches(f, part({ categoryId: "c1" })), false);
});

test("toggleFilterValue creates the field's filter, adds to it, and drops it with the last value", () => {
  let filters: PartFilter[] = [{ field: "category", negate: true, values: ["c1"] }];
  filters = toggleFilterValue(filters, "stock", undefined, "empty");
  filters = toggleFilterValue(filters, "stock", undefined, "low");
  assert.deepEqual(filters[1], { field: "stock", negate: false, values: ["empty", "low"] });
  // Adding to an existing filter keeps its "is not".
  filters = toggleFilterValue(filters, "category", undefined, "c2");
  assert.deepEqual(filters[0], { field: "category", negate: true, values: ["c1", "c2"] });
  filters = toggleFilterValue(filters, "stock", undefined, "empty");
  filters = toggleFilterValue(filters, "stock", undefined, "low");
  assert.deepEqual(
    filters.map((f) => f.field),
    ["category"],
  );
});

test("attribute filters are kept per key (case-insensitively), and checking a value leaves 'contains'", () => {
  let filters: PartFilter[] = [{ field: "attr", negate: false, key: "Drive", values: [], contains: "hex" }];
  filters = toggleFilterValue(filters, "attr", "Thread", "M3");
  filters = toggleFilterValue(filters, "attr", "drive", "Torx T10");
  assert.deepEqual(filters, [
    { field: "attr", negate: false, key: "Drive", values: ["Torx T10"] },
    { field: "attr", negate: false, key: "Thread", values: ["M3"] },
  ]);
  assert.equal(findFilter(filters, "attr", "THREAD")?.values[0], "M3");
});
