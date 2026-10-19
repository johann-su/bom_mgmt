import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, describeAll, subtreeIds, type FlatLocation } from "@/lib/location-tree";

const shelf = { id: "t-shelf", name: "Shelf", icon: "shelf", labelPattern: "{A}", position: 0 };
const box = { id: "t-box", name: "Box", icon: "box", labelPattern: "{N}", position: 1 };
const bin = { id: "t-bin", name: "Bin", icon: "bin", labelPattern: "{R}", position: 2 };

const loc = (id: string, parentId: string | null, type: FlatLocation["type"], label: string): FlatLocation => ({
  id,
  parentId,
  label,
  name: "",
  type,
});

const locations = [
  loc("b", null, shelf, "B"),
  loc("a", null, shelf, "A"),
  loc("a10", "a", box, "10"),
  loc("a2", "a", box, "2"),
  loc("a2-x", "a2", bin, "X"),
  loc("a2-ix", "a2", bin, "IX"),
];

test("siblings sort in the label's natural order (2 before 10, IX before X)", () => {
  const tree = buildTree(locations);
  assert.deepEqual(tree.map((n) => n.label), ["A", "B"]);
  assert.deepEqual(tree[0].children.map((n) => n.label), ["2", "10"]);
  assert.deepEqual(tree[0].children[0].children.map((n) => n.label), ["IX", "X"]);
});

test("describeAll gives each location its code and readable path, in tree order", () => {
  const described = describeAll(locations);
  assert.deepEqual(described.map((d) => d.code), ["A", "A/2", "A/2/IX", "A/2/X", "A/10", "B"]);
  assert.equal(described.find((d) => d.id === "a2-ix")!.path, "Shelf A › Box 2 › Bin IX");
});

test("subtreeIds covers all descendants — used to stop moving a box into itself", () => {
  assert.deepEqual([...subtreeIds(locations, "a2")].sort(), ["a2", "a2-ix", "a2-x"]);
});
