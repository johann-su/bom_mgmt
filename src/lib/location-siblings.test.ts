import { test } from "node:test";
import assert from "node:assert/strict";
import { siblingCycle, siblingLabels } from "@/lib/location-siblings";
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

const bin = { id: "t-bin", name: "Bin", icon: "box", labelPattern: "{1}", position: 2 };

test("siblingCycle walks same-type siblings in natural label order and wraps", () => {
  // B10 sorts after B2 (natural order), and the end wraps to the start.
  const all = [loc("b10", "box", bin, "10"), loc("b1", "box", bin, "1"), loc("b2", "box", bin, "2")];
  const last = siblingCycle(all, "b10")!;
  assert.equal(last.index, 2);
  assert.equal(last.total, 3);
  assert.equal(last.prev.id, "b2");
  assert.equal(last.next.id, "b1");
});

test("siblingCycle skips other types and other parents", () => {
  // A Shelf in the same box and a bin in another box aren't part of the ring.
  const all = [
    loc("b1", "box", bin, "1"),
    loc("s", "box", shelf, "A"),
    loc("b2", "box", bin, "2"),
    loc("x1", "other", bin, "1"),
  ];
  const c = siblingCycle(all, "b1")!;
  assert.equal(c.total, 2);
  assert.equal(c.next.id, "b2");
  assert.equal(c.prev.id, "b2");
});

test("siblingCycle is null for an only child — nothing to cycle", () => {
  assert.equal(siblingCycle([loc("b1", "box", bin, "1"), loc("s", "box", shelf, "A")], "b1"), null);
});
