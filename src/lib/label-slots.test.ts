import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTemplate,
  slotName,
  type GraphicElement,
  type LabelTemplate,
  type TextElement,
} from "@/lib/label-template";
import { renderLabelSvg, renderPages } from "@/lib/label-render";
import {
  applySlots,
  freeSlotName,
  parseSlots,
  slotConflicts,
  templateSlots,
  withSlot,
  type LabelSlots,
} from "@/lib/label-slots";

const square = '<rect width="10" height="10"/>';
const circle = '<circle cx="5" cy="5" r="5"/>';

const symbol: GraphicElement = {
  id: "g", kind: "graphic", x: 20, y: 0, w: 10, h: 10, slot: "symbol",
  markup: square, viewBox: [0, 0, 10, 10], stretch: false,
};
const spec: TextElement = {
  id: "t", kind: "text", x: 0, y: 0, w: 20, h: 10, slot: "spec", text: "{{name}}",
  fontSize: 8, bold: false, mono: false, align: "start", fit: false,
};
const template: LabelTemplate = {
  width: 30, height: 10, layout: { kind: "single" },
  elements: [spec, symbol, { id: "c", kind: "code", x: 0, y: 0, w: 5, h: 5, symbology: "qrcode", text: "{{code}}" }],
};
const vars = { code: "A1", name: "Bin name" };

test("a location without slot values prints the template's defaults", () => {
  assert.deepEqual(applySlots(template, {}), template);
  assert.deepEqual(applySlots(template, undefined), template);
});

test("slot values replace the content but keep the template's box and style", () => {
  const filled = applySlots(template, {
    spec: { kind: "text", text: "M3 × 8 {{code}}" },
    symbol: { kind: "graphic", markup: circle, viewBox: [0, 0, 10, 10], name: "Washer" },
  });
  const [text, graphic] = filled.elements as [TextElement, GraphicElement];
  assert.deepEqual({ ...text, text: spec.text }, spec);
  assert.equal(text.text, "M3 × 8 {{code}}");
  assert.equal(graphic.markup, circle);
  assert.equal(graphic.name, "Washer");
  assert.equal(graphic.x, symbol.x);
  // The original template (shared by every bin) is not mutated.
  assert.equal(symbol.markup, square);

  // Slot text is still a label text: {{variables}} are filled when rendering.
  const svg = renderLabelSvg(template, vars, { spec: { kind: "text", text: "M3 {{code}}" } }).body;
  assert.match(svg, /M3 A1/);
  assert.doesNotMatch(svg, /Bin name/);
});

test('"none" leaves the element off this location\'s label', () => {
  const filled = applySlots(template, { symbol: { kind: "none" } });
  assert.deepEqual(filled.elements.map((e) => e.id), ["t", "c"]);
});

test("a value whose kind no longer matches the slot falls back to the default instead of vanishing", () => {
  // The template changed "symbol" from a text slot to a graphic one.
  const filled = applySlots(template, { symbol: { kind: "text", text: "old" } });
  assert.equal((filled.elements[1] as GraphicElement).markup, square);
});

test("values are keyed by slot name, so they follow a type onto another template with the same slot", () => {
  const other: LabelTemplate = { ...template, width: 50, elements: [{ ...symbol, id: "different-id", x: 40 }] };
  const filled = applySlots(other, { symbol: { kind: "graphic", markup: circle, viewBox: [0, 0, 10, 10] } });
  assert.equal((filled.elements[0] as GraphicElement).markup, circle);
});

test("templateSlots lists each slot name once, with the first element as its default", () => {
  const twice: LabelTemplate = { ...template, elements: [...template.elements, { ...symbol, id: "g2", x: 0 }] };
  assert.deepEqual(
    templateSlots(twice).map((s) => [s.name, s.kind, s.element.id]),
    [["spec", "text", "t"], ["symbol", "graphic", "g"]],
  );
  // ...and every element with that name takes the value.
  const filled = applySlots(twice, { symbol: { kind: "graphic", markup: circle, viewBox: [0, 0, 10, 10] } });
  assert.deepEqual(filled.elements.filter((e) => e.kind === "graphic").map((e) => (e as GraphicElement).markup), [circle, circle]);
});

test("renderPages gives every label its own location's slot values", () => {
  const { pages } = renderPages(template, [
    { vars, slots: { spec: { kind: "text", text: "first" } } },
    { vars },
  ]);
  assert.match(pages[0], /first/);
  assert.match(pages[1], /Bin name/);
});

test("parseTemplate keeps valid slot names on text and graphic elements only", () => {
  const parsed = parseTemplate({
    ...template,
    elements: [{ ...spec, slot: "Not A Slug" }, symbol, { ...template.elements[2], slot: "code" }],
  }) as LabelTemplate;
  assert.equal((parsed.elements[0] as TextElement).slot, undefined);
  assert.equal((parsed.elements[1] as GraphicElement).slot, "symbol");
  assert.ok(!("slot" in parsed.elements[2]));
});

test("slotName turns what the user typed into a stable slug", () => {
  assert.equal(slotName("Screw head"), "screw-head");
  assert.equal(slotName("  2nd symbol!"), "nd-symbol");
  assert.equal(slotName("!!!"), "");
});

test("parseSlots re-sanitises graphics and rejects broken input rather than storing it", () => {
  const parsed = parseSlots({
    symbol: { kind: "graphic", markup: `<script>alert(1)</script>${square}`, viewBox: [0, 0, 10, 10] },
    spec: { kind: "text", text: "x", extra: true },
  }) as LabelSlots;
  assert.ok(parsed.symbol.kind === "graphic" && !parsed.symbol.markup.includes("script"));
  assert.deepEqual(parsed.spec, { kind: "text", text: "x" });

  assert.ok("error" in parseSlots({ "Bad Name": { kind: "none" } }));
  assert.ok("error" in parseSlots({ symbol: { kind: "graphic", markup: square, viewBox: [0, 0, 0, 10] } }));
  assert.ok("error" in parseSlots({ symbol: { kind: "bogus" } }));
  assert.ok("error" in parseSlots([]));
  assert.deepEqual(parseSlots(null), {});
});

test("withSlot sets or clears one slot and keeps the others (values for unused slots survive)", () => {
  const slots: LabelSlots = { old: { kind: "none" } };
  const set = withSlot(slots, "spec", { kind: "text", text: "a" });
  assert.deepEqual(Object.keys(set), ["old", "spec"]);
  assert.deepEqual(withSlot(set, "spec", null), slots);
  assert.deepEqual(Object.keys(slots), ["old"]);
});

test("a new slot gets an unused name, so it doesn't silently share another element's value", () => {
  assert.equal(freeSlotName(template, "symbol"), "symbol-2");
  assert.equal(freeSlotName(template, "note"), "note");
});

test("slotConflicts flags a name used by a text and a graphic, which no single value can fill", () => {
  assert.deepEqual(slotConflicts(template), []);
  const clash: LabelTemplate = { ...template, elements: [spec, { ...symbol, slot: "spec" }] };
  assert.deepEqual(slotConflicts(clash), ["spec"]);
});
