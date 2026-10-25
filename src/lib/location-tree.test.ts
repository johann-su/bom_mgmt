import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTree,
  describeAll,
  duplicateCodes,
  subtreeIds,
  validateSeparator,
  type FlatLocation,
} from "@/lib/location-tree";

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

test("the code separator is configurable, and may be empty (box A's bin 1 → A1)", () => {
  const codes = (sep: string) => describeAll(locations, sep).map((d) => d.code);
  assert.deepEqual(codes("-").slice(0, 3), ["A", "A-2", "A-2-IX"]);
  assert.deepEqual(codes("").slice(0, 3), ["A", "A2", "A2IX"]);
});

test("separators may be empty or punctuation, never letters, digits or braces", () => {
  // A letter or digit would read as part of a label: is "A1x2" A›1›2 or A›1x2?
  for (const ok of ["", "/", "-", " ", "·", "::"]) assert.ok("separator" in validateSeparator(ok), ok);
  for (const bad of ["x", "1", "{", "////"]) assert.ok("error" in validateSeparator(bad), bad);
});

test("duplicateCodes finds codes that an empty separator makes collide", () => {
  // Box 1 › bin 11 and box 11 › bin 1 are both "111" when nothing joins them.
  assert.deepEqual(duplicateCodes(["111", "A1", "111", "B"]), ["111"]);
  assert.deepEqual(duplicateCodes(["1/11", "11/1"]), []);
});
