import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupedPage,
  paginate,
  parseCollapsed,
  serializeCollapsed,
  parsePartsView,
  partsViewParams,
  sortParts,
  toggleSort,
  type SortablePart,
} from "@/lib/parts-list-view";

function part(over: Partial<SortablePart> & { name: string }): SortablePart {
  return {
    category: null,
    tracking: "exact",
    total: 10,
    minStock: null,
    locations: [],
    ...over,
  };
}

const names = (rows: SortablePart[]) => rows.map((r) => r.name);

test("parsePartsView falls back to name/asc/page 1 on junk input", () => {
  assert.deepEqual(parsePartsView({ sort: "price", dir: "sideways", page: "-3" }), {
    sort: "name",
    dir: "asc",
    page: 1,
  });
  assert.deepEqual(parsePartsView({ sort: "stock", dir: "desc", page: "4" }), {
    sort: "stock",
    dir: "desc",
    page: 4,
  });
});

test("partsViewParams omits defaults so the plain URL stays /parts", () => {
  assert.deepEqual(partsViewParams({ sort: "name", dir: "asc", page: 1 }), {});
  assert.deepEqual(partsViewParams({ sort: "stock", dir: "desc", page: 2 }), {
    sort: "stock",
    dir: "desc",
    page: "2",
  });
});

test("toggleSort flips the active column and starts a new column ascending, back on page 1", () => {
  const view = { sort: "name", dir: "asc", page: 3 } as const;
  assert.deepEqual(toggleSort(view, "name"), {
    sort: "name",
    dir: "desc",
    page: 1,
  });
  assert.deepEqual(toggleSort({ ...view, dir: "desc" }, "name"), {
    sort: "name",
    dir: "asc",
    page: 1,
  });
  assert.deepEqual(toggleSort({ ...view, dir: "desc" }, "category"), {
    sort: "category",
    dir: "asc",
    page: 1,
  });
});

test("name sort is natural: M3×4 comes before M3×10", () => {
  const rows = ["Screw M3×10", "Screw M3×4", "Screw M3×25", "screw M3×8"].map((name) => part({ name }));
  assert.deepEqual(names(sortParts(rows, "name", "asc")), [
    "Screw M3×4",
    "screw M3×8",
    "Screw M3×10",
    "Screw M3×25",
  ]);
});

test("parts without a category or location sort last in both directions", () => {
  const rows = [
    part({ name: "a", category: null }),
    part({ name: "b", category: "Fasteners" }),
    part({ name: "c", category: "Connectors" }),
  ];
  assert.deepEqual(names(sortParts(rows, "category", "asc")), ["c", "b", "a"]);
  assert.deepEqual(names(sortParts(rows, "category", "desc")), ["b", "c", "a"]);

  const located = [
    part({ name: "x", locations: [] }),
    part({ name: "y", locations: [{ code: "1B10" }] }),
    part({ name: "z", locations: [{ code: "1B9" }] }),
  ];
  assert.deepEqual(names(sortParts(located, "location", "asc")), ["z", "y", "x"]);
});

test("ties fall back to the name so variants of one category stay in order", () => {
  const rows = [
    part({ name: "M3×10", category: "Fasteners" }),
    part({ name: "M3×4", category: "Fasteners" }),
  ];
  assert.deepEqual(names(sortParts(rows, "category", "desc")), ["M3×4", "M3×10"]);
});

test("stock sort puts what needs attention first: empty, low, fine, untracked; counts before levels within a rank", () => {
  const rows = [
    part({ name: "untracked", tracking: "none", total: 0 }),
    part({ name: "plenty", tracking: "level", total: 2 }),
    part({ name: "low-level", tracking: "level", total: 1 }),
    part({ name: "below-min", total: 3, minStock: 5 }),
    part({ name: "empty", total: 0 }),
    part({ name: "many", total: 500 }),
    part({ name: "some", total: 20 }),
  ];
  assert.deepEqual(names(sortParts(rows, "stock", "asc")), [
    "empty",
    "below-min",
    "low-level",
    "some",
    "many",
    "plenty",
    "untracked",
  ]);
});

test("paginate clamps an out-of-range page to the last one", () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);
  const last = paginate(rows, 9, 50);
  assert.equal(last.page, 3);
  assert.equal(last.pageCount, 3);
  assert.deepEqual([last.from, last.to], [101, 120]);
  assert.equal(last.rows.length, 20);
  assert.deepEqual(paginate([], 1, 50).from, 0);
});

function cat(name: string, categoryId: string | null, over: Partial<SortablePart> = {}) {
  return { ...part({ name, category: categoryId && categoryId.toUpperCase(), ...over }), categoryId };
}

const shape = (items: ReturnType<typeof groupedPage>["items"]) =>
  items.map((i) => (i.kind === "group" ? `[${i.group.id}]` : i.row.name));

test("collapsed cookie keeps 'uncategorised' through the round trip", () => {
  assert.deepEqual([...parseCollapsed(serializeCollapsed(["a", "", "b"]))], ["a", "", "b"]);
  assert.equal(parseCollapsed(undefined).size, 0);
});

test("groupedPage: a header row per category, with empty/low counts for the whole group", () => {
  const rows = [
    cat("a1", "a", { total: 0 }),
    cat("a2", "a", { total: 3, minStock: 5 }),
    cat("b1", "b"),
    cat("x", null),
  ];
  const out = groupedPage(rows, new Set(), 1, 50);
  assert.deepEqual(shape(out.items), ["[a]", "a1", "a2", "[b]", "b1", "[]", "x"]);
  assert.deepEqual(
    out.groups.map((g) => [g.id, g.count, g.empty, g.low]),
    [
      ["a", 2, 1, 1],
      ["b", 1, 0, 0],
      ["", 1, 0, 0],
    ],
  );
});

test("groupedPage: collapsed groups keep their header but take no page slots", () => {
  const rows = [cat("a1", "a"), cat("a2", "a"), cat("b1", "b"), cat("b2", "b"), cat("c1", "c")];
  const out = groupedPage(rows, new Set(["a"]), 1, 2);
  assert.deepEqual(shape(out.items), ["[a]", "[b]", "b1", "b2"]);
  assert.equal(out.total, 3, "only expanded parts count towards paging");
  assert.deepEqual(shape(groupedPage(rows, new Set(["a"]), 2, 2).items), ["[c]", "c1"]);
});

test("groupedPage: a group split across pages repeats its header; trailing collapsed groups land on the last page", () => {
  const rows = [cat("a1", "a"), cat("a2", "a"), cat("a3", "a"), cat("z1", "z")];
  assert.deepEqual(shape(groupedPage(rows, new Set(["z"]), 2, 2).items), ["[a]", "a3", "[z]"]);
  // Everything collapsed: one page of headers.
  const all = groupedPage(rows, new Set(["a", "z"]), 1, 2);
  assert.deepEqual(shape(all.items), ["[a]", "[z]"]);
  assert.equal(all.pageCount, 1);
});
