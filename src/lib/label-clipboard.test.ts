import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClipboard, placePasted, serializeElements } from "@/lib/label-clipboard";
import type { LabelElement } from "@/lib/label-template";

const frame = (over: Partial<LabelElement> = {}): LabelElement =>
  ({ id: "f", kind: "frame", x: 2, y: 3, w: 10, h: 5, strokeWidth: 0.3, radius: 0, ...over }) as LabelElement;

test("copied elements round-trip through the clipboard text", () => {
  const els = [frame({ fill: "#000000", rotation: 90 } as Partial<LabelElement>)];
  assert.deepEqual(parseClipboard(serializeElements(els)), els);
});

test("anything that isn't our tagged JSON is not a paste of elements", () => {
  assert.equal(parseClipboard("hello"), null);
  assert.equal(parseClipboard(JSON.stringify({ elements: [frame()] })), null);
  assert.equal(parseClipboard(JSON.stringify({ type: "bom-mgmt/label-elements", elements: [] })), null);
});

test("pasted JSON is validated like a saved template — hostile fields don't get through", () => {
  const text = JSON.stringify({
    type: "bom-mgmt/label-elements",
    elements: [{ ...frame(), stroke: '"/><script>', onclick: "x" }],
  });
  const [el] = parseClipboard(text)!;
  assert.equal("stroke" in el, false);
  assert.equal("onclick" in el, false);
  // Broken elements reject the whole paste rather than half-pasting.
  assert.equal(
    parseClipboard(JSON.stringify({ type: "bom-mgmt/label-elements", elements: [{ kind: "nope" }] })),
    null,
  );
});

test("placePasted gives fresh ids and steps off elements already in the same spot", () => {
  let n = 0;
  const id = () => `new${++n}`;
  const original = frame();
  // Into an empty template (another label): lands exactly where it was copied.
  assert.deepEqual(placePasted([], [original], id).map((e) => [e.id, e.x, e.y]), [["new1", 2, 3]]);
  // Onto the original, then onto that copy too: a 1 mm staircase.
  const first = placePasted([original], [original], id);
  assert.deepEqual([first[0].x, first[0].y], [3, 4]);
  const second = placePasted([original, ...first], [original], id);
  assert.deepEqual([second[0].x, second[0].y], [4, 5]);
  assert.notEqual(second[0].id, original.id);
});
