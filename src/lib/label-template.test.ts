import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEMPLATES,
  SHEET_PRESETS,
  builtInIndex,
  fillVariables,
  graphicBox,
  locationVariables,
  parseTemplate,
  placeLabels,
  templateForType,
  templateOptions,
  uniqueName,
  unknownVariables,
  type LabelTemplate,
} from "@/lib/label-template";

const chain = [
  { id: "s", label: "A", name: "", type: { name: "Shelf" } },
  { id: "b", label: "1", name: "Fasteners", type: { name: "Box" } },
  { id: "x", label: "IV", name: "M3 inserts", type: { name: "Bin" } },
];

test("locationVariables derives code, parent and path from the ancestor chain", () => {
  const vars = locationVariables(chain, { url: "https://inv.example/locations/x" });
  assert.equal(vars.code, "A/1/IV");
  assert.equal(vars.parent, "A/1");
  assert.equal(vars.label, "IV");
  assert.equal(vars.type, "Bin");
  assert.equal(vars.name, "M3 inserts");
  assert.equal(vars.path, "Shelf A › Box 1 › Bin IV");
  assert.equal(vars.id, "x");
  // A top-level location has no parent code.
  assert.equal(locationVariables(chain.slice(0, 1), { url: "" }).parent, "");
});

test("fillVariables substitutes {{name}} (spaces allowed) and blanks unknown names", () => {
  const vars = locationVariables(chain, { url: "u" });
  assert.equal(fillVariables("{{type}} {{ label }}", vars), "Bin IV");
  assert.equal(fillVariables("x{{nope}}y", vars), "xy");
  // Single braces belong to label patterns, not templates — left alone.
  assert.equal(fillVariables("{A}{N}", vars), "{A}{N}");
});

test("unknownVariables flags typos so the designer can warn", () => {
  const t = DEFAULT_TEMPLATES[0].template;
  assert.deepEqual(unknownVariables(t), []);
  const typo: LabelTemplate = {
    ...t,
    elements: [{ ...t.elements[1], text: "{{cdoe}}" } as LabelTemplate["elements"][number]],
  };
  assert.deepEqual(unknownVariables(typo), ["cdoe"]);
});

test("every built-in template and sheet preset passes validation", () => {
  for (const { name, template } of DEFAULT_TEMPLATES) {
    assert.ok(!("error" in parseTemplate(template)), name);
  }
  for (const preset of SHEET_PRESETS) {
    const [width, height] = preset.label;
    const parsed = parseTemplate({ width, height, elements: [], layout: preset.layout });
    assert.ok(!("error" in parsed), preset.name);
  }
});

test("parseTemplate rejects hostile or broken input instead of storing it", () => {
  const base = DEFAULT_TEMPLATES[0].template;
  assert.ok("error" in parseTemplate(null));
  assert.ok("error" in parseTemplate({ ...base, width: 0 }));
  assert.ok("error" in parseTemplate({ ...base, width: Infinity }));
  assert.ok("error" in parseTemplate({ ...base, elements: [{ kind: "script", x: 0, y: 0, w: 1, h: 1 }] }));
  assert.ok(
    "error" in
      parseTemplate({ ...base, elements: [{ kind: "code", symbology: "pdf417", x: 0, y: 0, w: 1, h: 1 }] }),
  );
  assert.ok("error" in parseTemplate({ ...base, elements: [{ kind: "text", x: 0, y: 0, w: -1, h: 1, fontSize: 8 }] }));
});

test("parseTemplate drops unknown fields and defaults the layout to one label per page", () => {
  const parsed = parseTemplate({
    width: 40,
    height: 20,
    evil: "<script>",
    elements: [{ kind: "frame", x: 0, y: 0, w: 40, h: 20, onclick: "x" }],
  });
  assert.ok(!("error" in parsed));
  assert.deepEqual(parsed.layout, { kind: "single" });
  assert.equal("evil" in parsed, false);
  assert.equal("onclick" in parsed.elements[0], false);
});

test("parseTemplate normalises rotation to [0, 360) and leaves it out when unrotated", () => {
  const frame = { kind: "frame", x: 0, y: 0, w: 10, h: 5 };
  const parsed = parseTemplate({
    width: 40,
    height: 20,
    elements: [{ ...frame, rotation: -90 }, { ...frame, rotation: 360 }, { ...frame, rotation: "45" }],
  });
  assert.ok(!("error" in parsed));
  assert.equal(parsed.elements[0].rotation, 270);
  // A full turn, or a non-number, is no rotation at all — and isn't stored.
  assert.equal("rotation" in parsed.elements[1], false);
  assert.equal("rotation" in parsed.elements[2], false);
});

test("box styles: only #rrggbb colours get through (they land in SVG attributes)", () => {
  const parsed = parseTemplate({
    width: 40,
    height: 20,
    elements: [
      { kind: "frame", x: 0, y: 0, w: 40, h: 20, fill: "#FFAA00", stroke: 'red" onload="x', strokeWidth: 0 },
      { kind: "text", x: 0, y: 0, w: 40, h: 8, fontSize: 8, text: "", color: "#ffffff", fill: "#000000", radius: 1 },
      { kind: "text", x: 0, y: 8, w: 40, h: 8, fontSize: 8, text: "" },
    ],
  });
  assert.ok(!("error" in parsed));
  const [frame, badge, plain] = parsed.elements;
  // Lower-cased; the injection attempt is dropped; a 0 border is allowed (fill only).
  assert.equal(frame.kind === "frame" && frame.fill, "#ffaa00");
  assert.equal("stroke" in frame, false);
  assert.equal(frame.kind === "frame" && frame.strokeWidth, 0);
  assert.deepEqual(badge.kind === "text" && [badge.color, badge.fill, badge.radius], ["#ffffff", "#000000", 1]);
  // Unstyled text stays unstyled — no style keys appear.
  assert.deepEqual(Object.keys(plain).filter((k) => ["color", "fill", "stroke", "strokeWidth", "radius"].includes(k)), []);
});

test("a frame without style fields keeps the old defaults (0.3 mm black line, square corners)", () => {
  const parsed = parseTemplate({ width: 40, height: 20, elements: [{ kind: "frame", x: 0, y: 0, w: 40, h: 20 }] });
  assert.ok(!("error" in parsed));
  assert.deepEqual(
    parsed.elements[0].kind === "frame" && [parsed.elements[0].strokeWidth, parsed.elements[0].radius],
    [0.3, 0],
  );
});

test("graphics: stored markup is re-sanitised, and a broken or oversized one is rejected", () => {
  const graphic = { kind: "graphic", x: 0, y: 0, w: 10, h: 10, viewBox: [0, 0, 24, 24] };
  const parsed = parseTemplate({
    width: 40,
    height: 20,
    elements: [{ ...graphic, markup: '<path d="M0 0" onload="alert(1)"/><script>x</script>', name: "logo" }],
  });
  assert.ok(!("error" in parsed));
  const el = parsed.elements[0];
  assert.deepEqual(el.kind === "graphic" && [el.markup, el.stretch, el.name], ['<path d="M0 0"/>', false, "logo"]);

  const bad = (over: object) => "error" in parseTemplate({ width: 40, height: 20, elements: [{ ...graphic, markup: "<rect/>", ...over }] });
  assert.ok(bad({ markup: "<script>x</script>" }), "nothing drawable");
  assert.ok(bad({ viewBox: [0, 0, 0, 24] }), "zero-size viewBox");
  assert.ok(bad({ viewBox: "0 0 24 24" }), "viewBox must be numbers");
  // Many big graphics together would overflow the 1 MB server-action limit.
  // ~130 kB each (just under the per-graphic cap), five of them ≈ 650 kB.
  const big = Array(3).fill(`<path d="M${"0 ".repeat(22_000)}"/>`).join("");
  assert.ok("error" in parseTemplate({ width: 40, height: 20, elements: Array(5).fill({ ...graphic, markup: big }) }));
});

test("graphicBox centres a new graphic as large as fits, keeping its shape", () => {
  // Wide graphic on a 40×20 label: width-limited to 38 mm.
  assert.deepEqual(graphicBox({ width: 40, height: 20 }, [0, 0, 100, 25]), { x: 1, y: 5.25, w: 38, h: 9.5 });
  // Square graphic: height-limited.
  assert.deepEqual(graphicBox({ width: 40, height: 20 }, [0, 0, 24, 24]), { x: 11, y: 1, w: 18, h: 18 });
});

test("a sheet grid wider than the paper is rejected — the last column would print off the edge", () => {
  const layout = { ...SHEET_PRESETS[0].layout, columns: 6 };
  assert.ok("error" in parseTemplate({ width: 38.1, height: 21.2, elements: [], layout }));
});

test("placeLabels fills a sheet row by row and spills onto the next page", () => {
  const sheet: LabelTemplate = {
    width: 50,
    height: 20,
    elements: [],
    layout: {
      kind: "sheet", pageWidth: 120, pageHeight: 60, columns: 2, rows: 2,
      marginTop: 5, marginLeft: 10, gapX: 4, gapY: 2,
    },
  };
  const placed = placeLabels(sheet, 5);
  assert.deepEqual(placed[0], { page: 0, x: 10, y: 5 });
  assert.deepEqual(placed[1], { page: 0, x: 64, y: 5 });
  assert.deepEqual(placed[2], { page: 0, x: 10, y: 27 });
  assert.deepEqual(placed[4], { page: 1, x: 10, y: 5 });
});

test("placeLabels can skip used cells of a partly used sheet", () => {
  const sheet = { width: 38.1, height: 21.2, elements: [], layout: SHEET_PRESETS[0].layout };
  const [first] = placeLabels(sheet, 1, 6);
  // Cell 6 of a 5-wide grid is row 2, column 2.
  assert.equal(first.page, 0);
  assert.ok(Math.abs(first.y - (10.7 + 21.2)) < 1e-9);
  assert.ok(Math.abs(first.x - (4.75 + 38.1 + 2.5)) < 1e-9);
});

test("one-label-per-page layouts (label printers) put every label at the origin of its own page", () => {
  const placed = placeLabels(DEFAULT_TEMPLATES[0].template, 3, 2);
  assert.deepEqual(placed, [
    { page: 0, x: 0, y: 0 },
    { page: 1, x: 0, y: 0 },
    { page: 2, x: 0, y: 0 },
  ]);
});

test("a type without an assigned template (or whose template was deleted) falls back to the first built-in", () => {
  const saved = [{ id: "t1", name: "Mine", template: DEFAULT_TEMPLATES[1].template }];
  const options = templateOptions(saved);
  assert.equal(templateForType(options, "t1").key, "t1");
  assert.equal(templateForType(options, null).name, DEFAULT_TEMPLATES[0].name);
  assert.equal(templateForType(options, "deleted").builtIn, true);
});

test("built-in keys round-trip and junk keys are not built-ins", () => {
  const options = templateOptions([]);
  assert.equal(builtInIndex(options[1].key), 1);
  assert.equal(builtInIndex("builtin-999"), null);
  assert.equal(builtInIndex("0b7e2f8c-4f0e-4a43-9d1a-2f6f1d9c0a11"), null);
});

test("uniqueName numbers copies instead of colliding with the unique name constraint", () => {
  assert.equal(uniqueName("Bin label", []), "Bin label");
  assert.equal(uniqueName("Bin label", ["Bin label", "Bin label (2)"]), "Bin label (3)");
});
