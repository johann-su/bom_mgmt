import { test } from "node:test";
import assert from "node:assert/strict";
import { siblingLabels } from "@/lib/location-siblings";
import type { FlatLocation } from "@/lib/location-tree";

const shelf = { id: "t-shelf", name: "Shelf", icon: "shelf", labelPattern: "{A}", position: 0 };
const rack = { id: "t-rack", name: "Rack", icon: "shelf", labelPattern: "{A}", position: 1 };

const loc = (id: string, parentId: string | null, type: FlatLocation["type"], label: string): FlatLocation => ({
  id,
  parentId,
  label,
  name: "",
  type,
});

test("sibling labels span all types, so a new Rack can't reuse Shelf A's code 'A'", () => {
  const all = [loc("a", null, shelf, "A"), loc("b", null, rack, "B"), loc("a1", "a", shelf, "C")];
  assert.deepEqual(siblingLabels(all, null).sort(), ["A", "B"]);
  assert.deepEqual(siblingLabels(all, "a"), ["C"]);
});
