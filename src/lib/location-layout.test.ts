import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLayout } from "@/lib/location-layout";
import type { FlatLocation } from "@/lib/location-tree";

const shelf = { id: "t-shelf", name: "Shelf", icon: "shelf", labelPattern: "{A}", position: 0 };
const box = { id: "t-box", name: "Box", icon: "box", labelPattern: "{N}", position: 1 };
const bin = { id: "t-bin", name: "Bin", icon: "bin", labelPattern: "{R}", position: 2 };
const spool = { id: "t-spool", name: "Spool", icon: "box", labelPattern: "{N}", position: 3 };

const loc = (id: string, parentId: string | null, type: FlatLocation["type"], label: string): FlatLocation => ({
  id,
  parentId,
  label,
  name: "",
  type,
});

test("same-typed nodes on the same type path fold into one entry with a total count", () => {
  // Two shelves, each with boxes holding bins: one Shelf › Box › Bin arm.
  const layout = buildLayout([
    loc("a", null, shelf, "A"),
    loc("b", null, shelf, "B"),
    loc("a1", "a", box, "1"),
    loc("b1", "b", box, "1"),
    loc("b2", "b", box, "2"),
    loc("a1-i", "a1", bin, "I"),
    loc("b2-i", "b2", bin, "I"),
    loc("b2-ii", "b2", bin, "II"),
  ]);
  assert.equal(layout.length, 1);
  assert.deepEqual(
    [layout[0].count, layout[0].children[0].count, layout[0].children[0].children[0].count],
    [2, 3, 3],
  );
});

test("branches built differently stay separate arms (shelf of boxes vs shelf of spools)", () => {
  const layout = buildLayout([
    loc("a", null, shelf, "A"),
    loc("a1", "a", box, "1"),
    loc("a-s1", "a", spool, "1"),
    loc("a-s1-i", "a-s1", bin, "I"),
    loc("a1-i", "a1", bin, "I"),
  ]);
  const arms = layout[0].children;
  assert.deepEqual(arms.map((n) => n.type.name), ["Box", "Spool"]);
  // A Bin under a Box and a Bin under a Spool are different layout entries.
  assert.notEqual(arms[0].children[0].key, arms[1].children[0].key);
});

test("the label range uses the type's natural order (II–X, not X–II)", () => {
  const layout = buildLayout([
    loc("a", null, shelf, "A"),
    loc("x", "a", bin, "X"),
    loc("ii", "a", bin, "II"),
    loc("v", "a", bin, "V"),
  ]);
  const bins = layout[0].children[0];
  assert.deepEqual([bins.first, bins.last], ["II", "X"]);
});
