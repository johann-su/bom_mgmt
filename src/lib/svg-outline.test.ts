import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFontSet, textOutliner } from "@/lib/label-fonts";
import { renderLabelSvg } from "@/lib/label-render";
import { SAMPLE_VARIABLES, type LabelElement, type LabelTemplate } from "@/lib/label-template";
import icons from "@/lib/label-icons.json";
import { flattenPath } from "@/lib/svg-geometry";
import { outlineSvg } from "@/lib/svg-outline";

const fonts = loadFontSet(async (file) => {
  const b = readFileSync(`public/fonts/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
});

const label = (...elements: LabelElement[]): string =>
  renderLabelSvg({ width: 40, height: 20, layout: { kind: "single" }, elements } as LabelTemplate, SAMPLE_VARIABLES)
    .body;

/** Whether the single output path covers (x, y), by the even-odd rule. */
function inkAt(svg: string, x: number, y: number): boolean {
  const d = /<path [^>]*d="([^"]*)"/.exec(svg)?.[1] ?? "";
  let inside = false;
  for (const { points } of flattenPath(d, 0.01)) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [a, b] = [points[i], points[j]];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

const frame = (over: object = {}) =>
  ({ id: "f", kind: "frame", x: 0, y: 0, w: 40, h: 20, strokeWidth: 1, radius: 0, ...over }) as LabelElement;
const text = (over: object = {}) =>
  ({
    id: "t", kind: "text", x: 0, y: 0, w: 40, h: 20, text: "H", fontSize: 40,
    bold: true, mono: false, align: "middle", fit: false, ...over,
  }) as LabelElement;

test("the output is one filled path at the label's size — no text, masks or strokes left", async () => {
  const nut = (icons as { id: string; markup: string; viewBox: number[] }[]).find((i) => i.id.endsWith("hex-nut"))!;
  const { svg, warnings } = outlineSvg(
    label(
      frame(),
      text(),
      { id: "g", kind: "graphic", x: 0, y: 0, w: 20, h: 20, markup: nut.markup, viewBox: nut.viewBox, stretch: false } as LabelElement,
      { id: "c", kind: "code", x: 30, y: 2, w: 8, h: 16, symbology: "code128", text: "A1" } as LabelElement,
    ),
    textOutliner(await fonts),
  );
  assert.match(svg, /^<svg [^>]*width="40mm" height="20mm" viewBox="0 0 40 20">/);
  assert.equal(svg.match(/<path /g)?.length, 1);
  assert.doesNotMatch(svg, /<text|<mask|<g|stroke|url\(/);
  assert.deepEqual(warnings, []);
});

test("text becomes glyph outlines: a bold H has ink in its stems but not between them", async () => {
  const { svg } = outlineSvg(label(text()), textOutliner(await fonts));
  // 40 pt ≈ 14 mm, cap top ≈ 2.7 mm: at y = 4 (above the cross-bar) a row
  // through the H crosses exactly two inked runs, its stems.
  const row = Array.from({ length: 400 }, (_, i) => inkAt(svg, i / 10, 4));
  const runs = row.filter((v, i) => v && !row[i - 1]).length;
  assert.equal(runs, 2);
  assert.ok(!inkAt(svg, 20, 4), "the gap between the stems");
  assert.ok(!inkAt(svg, 1, 1) && !inkAt(svg, 39, 19), "nothing outside the glyph");
});

test("white on black cuts holes: a white-on-black text box keeps its bar but loses the letters", async () => {
  const badge = text({ text: "I", fill: "#000000", color: "#ffffff", fontSize: 30, mono: true });
  const { svg } = outlineSvg(label(badge), textOutliner(await fonts));
  assert.ok(inkAt(svg, 2, 10), "the bar is ink");
  // The I's stem runs down the centre of the box.
  assert.ok(!inkAt(svg, 20, 10), "the letter is a hole");
});

test("strokes become filled outlines: a frame is a ring, not a filled box", () => {
  const { svg } = outlineSvg(label(frame()), null);
  assert.ok(inkAt(svg, 0.5, 10), "the line itself");
  assert.ok(!inkAt(svg, 20, 10), "the inside stays empty");
});

test("masks cut real holes: the hex nut icon's bore is empty, its body is ink", () => {
  const nut = (icons as { id: string; markup: string; viewBox: number[] }[]).find((i) => i.id.endsWith("hex-nut"))!;
  const g = { id: "g", kind: "graphic", x: 0, y: 0, w: 20, h: 20, markup: nut.markup, viewBox: nut.viewBox, stretch: false };
  const { svg } = outlineSvg(label(g as LabelElement), null);
  assert.ok(!inkAt(svg, 10, 10), "bore");
  assert.ok(inkAt(svg, 10, 3), "body");
});

test("1D barcodes (stroked bars) come out as filled bars", () => {
  const code = { id: "c", kind: "code", x: 0, y: 0, w: 40, h: 20, symbology: "code128", text: "A1" } as LabelElement;
  const { svg } = outlineSvg(label(code), null);
  // Code 128 starts with a 2-module bar at the left edge.
  const row = Array.from({ length: 400 }, (_, i) => inkAt(svg, i / 10, 10));
  assert.ok(row[1], "first bar");
  assert.ok(row.some((v) => !v), "gaps between bars");
});

test("rotation and other transforms are applied to the geometry", () => {
  const bar = frame({ x: 15, y: 5, w: 10, h: 2, fill: "#000000", strokeWidth: 0, rotation: 90 });
  const { svg } = outlineSvg(label(bar), null);
  // A 10×2 bar turned upright about its centre (20, 6): covers y 1–11 at x = 20.
  assert.ok(inkAt(svg, 20, 2) && inkAt(svg, 20, 10));
  assert.ok(!inkAt(svg, 16, 6), "no longer reaches sideways");
});

test("without fonts, text is left out and reported rather than failing the export", () => {
  const { svg, warnings } = outlineSvg(label(text()), null);
  assert.ok(!inkAt(svg, 20, 7));
  assert.ok(warnings.some((w) => /text/i.test(w)));
});

test("arc flags written without separators still parse (as minifiers emit them)", () => {
  // Half circle of radius 5 from (0,5) to (10,5): "a5 5 0 011 0" style flags.
  const [line] = flattenPath("M0 5a5 5 0 0110 0", 0.01);
  const top = Math.min(...line.points.map((p) => p.y));
  assert.ok(Math.abs(top) < 0.02, `reaches y = 0, got ${top}`);
});
