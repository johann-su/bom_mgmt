import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory, record, redo, undo } from "@/lib/undo-history";

test("undo and redo walk back and forth through recorded values", () => {
  let h = createHistory("a");
  h = record(h, "b", { at: 0 });
  h = record(h, "c", { at: 5000 });
  h = undo(h);
  assert.equal(h.present, "b");
  h = undo(h);
  assert.equal(h.present, "a");
  // Nothing further back: undo is a no-op rather than an error.
  assert.equal(undo(h).present, "a");
  h = redo(redo(h));
  assert.equal(h.present, "c");
  assert.equal(redo(h).present, "c");
});

test("a new change after undo drops the redo steps", () => {
  let h = record(record(createHistory(1), 2, { at: 0 }), 3, { at: 0 });
  h = record(undo(h), 9, { at: 0 });
  assert.equal(redo(h).present, 9);
  assert.equal(undo(h).present, 2);
});

test("changes with the same key in quick succession are one undo step (typing in a field)", () => {
  let h = createHistory("");
  h = record(h, "h", { key: "text", at: 0 });
  h = record(h, "hi", { key: "text", at: 300 });
  // A pause longer than the window starts a new step…
  h = record(h, "hi!", { key: "text", at: 3000 });
  assert.equal(undo(h).present, "hi");
  assert.equal(undo(undo(h)).present, "");
  // …and so does a different key, however quick.
  const other = record(record(createHistory(""), "a", { key: "x", at: 0 }), "ab", { key: "y", at: 1 });
  assert.equal(undo(other).present, "a");
});

test("a drag merges into one step however long it pauses (window: Infinity)", () => {
  let h = createHistory({ x: 0 });
  for (const [x, at] of [[1, 0], [2, 10_000], [3, 60_000]]) {
    h = record(h, { x }, { key: "drag:1", at, window: Infinity });
  }
  assert.deepEqual(undo(h).present, { x: 0 });
});

test("an edit right after undo doesn't merge into the step that was undone", () => {
  let h = record(record(createHistory(""), "a", { key: "t", at: 0 }), "ab", { key: "t", at: 2000 });
  h = record(undo(h), "aX", { key: "t", at: 2100 });
  assert.equal(undo(h).present, "a");
});

test("recording the identical value is not a step", () => {
  const h = createHistory({ x: 1 });
  assert.equal(record(h, h.present, { at: 0 }), h);
});
