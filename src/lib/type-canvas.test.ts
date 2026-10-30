import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoLayout,
  COLUMN_WIDTH,
  depths,
  placeTypes,
  routeLink,
  withLink,
  withoutLink,
  type CanvasType,
} from "@/lib/type-canvas";

const t = (id: string, childTypeIds: string[] | null, at: [number, number] | null = null): CanvasType => ({
  id,
  childTypeIds,
  canvasX: at?.[0] ?? null,
  canvasY: at?.[1] ?? null,
});

test("depth follows the grammar: Shelf → Box → Bin are columns 0, 1, 2", () => {
  const d = depths([t("shelf", ["box", "drawer"]), t("box", ["bin"]), t("bin", []), t("drawer", [])]);
  assert.deepEqual(
    ["shelf", "box", "bin", "drawer"].map((id) => d.get(id)),
    [0, 1, 2, 1],
  );
});

test("a type holding itself (Box in Box) or sitting in a pure cycle doesn't break layout", () => {
  const d = depths([t("box", ["box", "bin"]), t("bin", []), t("a", ["b"]), t("b", ["a"])]);
  assert.equal(d.get("box"), 0);
  assert.equal(d.get("bin"), 1);
  // A ⇄ B: nothing outside holds either, so both fall back to column 0.
  assert.deepEqual([d.get("a"), d.get("b")], [0, 0]);
});

test("'any' types draw no links, so they don't push anything into a column", () => {
  const d = depths([t("shelf", null), t("box", [])]);
  assert.deepEqual([d.get("shelf"), d.get("box")], [0, 0]);
});

test("auto layout stacks types sharing a column instead of overlapping them", () => {
  const layout = autoLayout([t("shelf", ["box", "drawer"]), t("box", []), t("drawer", [])]);
  assert.equal(layout.get("box")!.x, COLUMN_WIDTH);
  assert.equal(layout.get("drawer")!.x, COLUMN_WIDTH);
  assert.notEqual(layout.get("box")!.y, layout.get("drawer")!.y);
});

test("saved positions win; a new unplaced type lands below every placed one", () => {
  const spots = placeTypes([t("shelf", ["box"], [500, 40]), t("box", [], [800, 300]), t("new", [])]);
  assert.deepEqual(spots.get("shelf"), { x: 500, y: 40 });
  assert.ok(spots.get("new")!.y > 300);
});

test("linking from an 'any' type restricts it to that one link", () => {
  assert.deepEqual(withLink(null, "box"), ["box"]);
  assert.deepEqual(withLink(["bin"], "box"), ["bin", "box"]);
  assert.deepEqual(withLink(["box"], "box"), ["box"]);
});

test("unlinking the last child leaves a parts-only type (empty list), not 'any'", () => {
  assert.deepEqual(withoutLink(["box"], "box"), []);
  assert.equal(withoutLink(null, "box"), null);
});

// Cards are 240 × 56; a link runs from a right handle to a left handle.
const card = (x: number, y: number) => ({ x, y, width: 240, height: 56 });
const right = (r: ReturnType<typeof card>) => ({ x: r.x + r.width, y: r.y + r.height / 2 });
const left = (r: ReturnType<typeof card>) => ({ x: r.x, y: r.y + r.height / 2 });
// Every coordinate pair in an SVG path (enough to check where it goes).
const pathPoints = (path: string) =>
  [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

test("a link to a type further right with nothing between is a plain curve", () => {
  const a = card(0, 0);
  const b = card(340, 0);
  const link = routeLink(right(a), left(b), [a, b]);
  assert.equal(link.routed, false);
  assert.match(link.path, / C /);
});

test("a link pointing back left is routed around the cards, never through them", () => {
  // test2 (right) → test1 (left), side by side: a curve would run behind both.
  const test1 = card(0, 0);
  const test2 = card(340, 0);
  const link = routeLink(right(test2), left(test1), [test1, test2]);
  assert.equal(link.routed, true);
  const lane = link.label.y;
  // The lane clears both cards entirely (above them or below them).
  assert.ok(lane < 0 || lane > 56, `lane at ${lane}`);
  // It leaves right of the source and comes in left of the target.
  const points = pathPoints(link.path);
  assert.ok(points.some((p) => p.x > test2.x + 240));
  assert.ok(points.some((p) => p.x < test1.x));
});

test("a forward link that would cross a card in between goes around it", () => {
  // Shelf → Bin with Box between them on the same row.
  const shelf = card(0, 0);
  const box = card(340, 0);
  const bin = card(680, 0);
  const link = routeLink(right(shelf), left(bin), [shelf, box, bin]);
  assert.equal(link.routed, true);
  assert.ok(link.label.y < 0 || link.label.y > 56);
});

test("routed links take the shorter way round: above when a card blocks below", () => {
  const test1 = card(0, 0);
  const test2 = card(340, 0);
  const below = card(100, 80);
  const link = routeLink(right(test2), left(test1), [test1, test2, below]);
  assert.ok(link.label.y < 0, "lane above the row");
});

test("a back link between cards in one row goes below, leaving the top to self-loops", () => {
  const test1 = card(0, 0);
  const test2 = card(340, 0);
  const link = routeLink(right(test2), left(test1), [test1, test2]);
  assert.ok(link.label.y > 56, "lane below the row");
});
