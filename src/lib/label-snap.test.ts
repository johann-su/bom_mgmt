import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignElements,
  alignToLabel,
  boundingBox,
  distributeElements,
  touches,
  resizeRotated,
  snapMove,
  snapResize,
  snapRotation,
  snapTargets,
} from "@/lib/label-snap";

const label = { width: 60, height: 30 };
const opts = { grid: 1, threshold: 1, objects: true };

test("snapMove falls back to the grid when no edge is near a target", () => {
  const targets = snapTargets(label, []);
  const { box, guides } = snapMove({ x: 10.3, y: 5.6, w: 7, h: 4 }, targets, opts);
  assert.deepEqual(box, { x: 10, y: 6, w: 7, h: 4 });
  assert.deepEqual(guides, []);
});

test("snapMove centres an element on the label's centre line and reports the guide", () => {
  const targets = snapTargets(label, []);
  // Centre at 30.6 is within 1 mm of the label centre (30) → x = 30 - 10/2.
  const { box, guides } = snapMove({ x: 25.6, y: 12.2, w: 10, h: 3 }, targets, opts);
  assert.equal(box.x, 25);
  assert.ok(guides.some((g) => g.axis === "x" && g.at === 30));
});

test("snapMove lines an edge up with another element's edge, beating the grid", () => {
  // Other element's right edge is at 22.5 (off-grid): the left edge sticks to it.
  const targets = snapTargets(label, [{ x: 2.5, y: 2, w: 20, h: 5 }]);
  const { box, guides } = snapMove({ x: 22.9, y: 15.4, w: 5, h: 5 }, targets, opts);
  assert.equal(box.x, 22.5);
  assert.deepEqual(guides.filter((g) => g.axis === "x"), [{ axis: "x", at: 22.5 }]);
});

test("snapMove with object snapping off only uses the grid", () => {
  const targets = snapTargets(label, [{ x: 2.5, y: 2, w: 20, h: 5 }]);
  const { box, guides } = snapMove({ x: 22.9, y: 15.4, w: 5, h: 5 }, targets, { ...opts, objects: false });
  assert.equal(box.x, 23);
  assert.deepEqual(guides, []);
});

test("grid 0 means free placement (still rounded to 0.01 mm)", () => {
  const { box } = snapMove({ x: 10.333, y: 5.666, w: 7, h: 4 }, snapTargets(label, []), {
    ...opts, grid: 0, objects: false,
  });
  assert.deepEqual(box, { x: 10.33, y: 5.67, w: 7, h: 4 });
});

test("snapResize snaps the far edge to the label edge and to the grid, never below minSize", () => {
  const targets = snapTargets(label, []);
  const toEdge = snapResize({ x: 10, y: 5.5, w: 49.4, h: 3.2 }, targets, { ...opts, minSize: 1 });
  // Right edge 59.4 → label edge 60; bottom edge 8.7 → grid line 9 (from an off-grid y).
  assert.equal(toEdge.box.w, 50);
  assert.equal(toEdge.box.h, 3.5);
  assert.ok(toEdge.guides.some((g) => g.axis === "x" && g.at === 60));

  const tiny = snapResize({ x: 10, y: 10, w: -3, h: 0.1 }, targets, { ...opts, objects: false, minSize: 1 });
  assert.deepEqual([tiny.box.w, tiny.box.h], [1, 1]);
});

test("alignToLabel moves only along the chosen axis", () => {
  const box = { x: 3, y: 4, w: 10, h: 6 };
  assert.deepEqual(alignToLabel(box, label, "left"), { x: 0, y: 4 });
  assert.deepEqual(alignToLabel(box, label, "center"), { x: 25, y: 4 });
  assert.deepEqual(alignToLabel(box, label, "right"), { x: 50, y: 4 });
  assert.deepEqual(alignToLabel(box, label, "top"), { x: 3, y: 0 });
  assert.deepEqual(alignToLabel(box, label, "middle"), { x: 3, y: 12 });
  assert.deepEqual(alignToLabel(box, label, "bottom"), { x: 3, y: 24 });
});

test("snapResize with a ratio (Shift) keeps proportions, led by the axis pulled further", () => {
  const targets = snapTargets(label, []);
  const square = { ...opts, objects: false, minSize: 1, ratio: 1 };
  // Pulled wider than tall → the width (snapped to the grid) decides both.
  assert.deepEqual(snapResize({ x: 2, y: 2, w: 12.2, h: 8 }, targets, square).box, { x: 2, y: 2, w: 12, h: 12 });
  // Pulled taller → the height decides; a 2:1 box stays 2:1.
  const wide = snapResize({ x: 2, y: 2, w: 10, h: 7.8 }, targets, { ...square, ratio: 2 });
  assert.deepEqual([wide.box.w, wide.box.h], [16, 8]);
  // Shrinking below the minimum grows both sides, so the shape survives.
  const tiny = snapResize({ x: 2, y: 2, w: 0.2, h: -1 }, targets, { ...square, ratio: 2 });
  assert.deepEqual([tiny.box.w, tiny.box.h], [2, 1]);
});

test("a rotated element snaps and aligns by its visible bounding box", () => {
  // 20×4 turned 90° covers 4×20 around the same centre (20, 12).
  const bar = { x: 10, y: 10, w: 20, h: 4, rotation: 90 };
  const bb = boundingBox(bar);
  assert.deepEqual([bb.x, bb.y, bb.w, bb.h].map((v) => +v.toFixed(6)), [18, 2, 4, 20]);
  assert.deepEqual(alignToLabel(bar, label, "left"), { x: -8, y: 10 });
  assert.deepEqual(alignToLabel(bar, label, "top"), { x: 10, y: 8 });
  // Its visible left edge (17.6 after the drag) snaps to the grid at 18.
  const moved = snapMove({ ...bar, x: 9.6 }, snapTargets(label, []), { ...opts, objects: false });
  assert.equal(moved.box.x, 10);
});

test("resizeRotated measures the drag along the element's axes and pins its top-left corner", () => {
  // Turned 90° clockwise, the element's own "right" points down the label,
  // so dragging the handle 5 mm down makes it 5 mm longer.
  const start = { x: 0, y: 0, w: 10, h: 4, rotation: 90 };
  const grown = resizeRotated(start, 0, 5, { minSize: 1, keepRatio: false });
  assert.deepEqual([grown.w, grown.h], [15, 4]);
  // The pinned corner (local top-left) is at centre + R(-w/2, -h/2) before and after.
  const corner = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2 + r.h / 2, r.y + r.h / 2 - r.w / 2];
  assert.deepEqual(corner(grown).map((v) => +v.toFixed(2)), corner(start));

  const kept = resizeRotated(start, 0, 5, { minSize: 1, keepRatio: true });
  assert.deepEqual([kept.w, kept.h], [15, 6]);
});

test("snapRotation: Shift locks to the step, otherwise it sticks near right angles unless free", () => {
  assert.equal(snapRotation(37, { step: 15 }), 30);
  assert.equal(snapRotation(-50, { step: 15 }), 315);
  assert.equal(snapRotation(92.5), 90);
  assert.equal(snapRotation(92.5, { free: true }), 92.5);
  assert.equal(snapRotation(358), 0);
  assert.equal(snapRotation(47.26), 47.3);
});

test("alignElements: one element aligns to the label, several align to each other", () => {
  const a = { id: "a", x: 5, y: 2, w: 10, h: 4 };
  const b = { id: "b", x: 20, y: 10, w: 6, h: 8 };
  assert.deepEqual(alignElements([a], label, "right"), { a: { x: 50, y: 2 } });
  // Together they cover x 5–26, y 2–18: left edges go to 5, bottoms to 18,
  // centres to the middle of that box.
  assert.deepEqual(alignElements([a, b], label, "left"), { a: { x: 5, y: 2 }, b: { x: 5, y: 10 } });
  assert.deepEqual(alignElements([a, b], label, "bottom"), { a: { x: 5, y: 14 }, b: { x: 20, y: 10 } });
  assert.deepEqual(alignElements([a, b], label, "middle"), { a: { x: 5, y: 8 }, b: { x: 20, y: 6 } });
});

test("distributeElements equalises the gaps, keeps the outer two and ignores list order", () => {
  const boxes = [
    { id: "right", x: 40, y: 0, w: 10, h: 5 },
    { id: "left", x: 0, y: 0, w: 10, h: 5 },
    { id: "mid", x: 12, y: 3, w: 4, h: 5 },
  ];
  // Span 0–50 holds 24 mm of elements → two 13 mm gaps.
  assert.deepEqual(distributeElements(boxes, "x"), {
    left: { x: 0, y: 0 },
    mid: { x: 23, y: 3 },
    right: { x: 40, y: 0 },
  });
  // Fewer than three: nothing to spread.
  assert.deepEqual(distributeElements(boxes.slice(0, 2), "x"), {});
});

test("touches selects anything a drag-select box overlaps, judged by the visible box", () => {
  const area = { x: 0, y: 0, w: 10, h: 10 };
  assert.ok(touches({ x: 8, y: 8, w: 5, h: 5 }, area));
  assert.ok(!touches({ x: 12, y: 0, w: 5, h: 5 }, area));
  // 20×2 turned 90° around (21, 11) reaches up to y 1 and left to x 20 — still outside.
  assert.ok(!touches({ x: 11, y: 10, w: 20, h: 2, rotation: 90 }, area));
  assert.ok(touches({ x: 1, y: 10, w: 20, h: 2, rotation: 90 }, area));
});
