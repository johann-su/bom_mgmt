import { test } from "node:test";
import assert from "node:assert/strict";
import { moveElements, restack } from "@/lib/label-order";

// Drawing order: a is at the back, e in front.
const els = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((e) => e.id).join("");

test("moveElements drops elements behind or in front of the anchor", () => {
  assert.equal(ids(moveElements(els, ["a"], "d", "after")), "bcdae");
  assert.equal(ids(moveElements(els, ["e"], "b", "before")), "aebcd");
  // A multi-selection keeps its own order, wherever its members were.
  assert.equal(ids(moveElements(els, ["d", "a"], "b", "after")), "badce");
});

test("moveElements onto itself, or to where it already is, is a no-op (same array → no undo step)", () => {
  assert.equal(moveElements(els, ["b", "c"], "c", "after"), els);
  assert.equal(moveElements(els, ["c"], "b", "after"), els);
  assert.equal(moveElements(els, ["c"], "gone", "after"), els);
});

test("restack forward/backward steps past one unselected element; front/back go all the way", () => {
  assert.equal(ids(restack(els, ["b"], "forward")), "acbde");
  assert.equal(ids(restack(els, ["d"], "backward")), "abdce");
  assert.equal(ids(restack(els, ["b", "d"], "front")), "acebd");
  assert.equal(ids(restack(els, ["b", "d"], "back")), "bdace");
});

test("a selection at the edge stays put, and an adjacent block moves as one", () => {
  assert.equal(restack(els, ["e"], "forward"), els);
  assert.equal(restack(els, ["a", "b"], "backward"), els);
  assert.equal(ids(restack(els, ["b", "c"], "forward")), "adbce");
  // d and e are already in front: only b moves up.
  assert.equal(ids(restack(els, ["b", "d", "e"], "forward")), "acbde");
});
