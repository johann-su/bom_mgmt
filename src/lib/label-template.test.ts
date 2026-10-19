import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEMPLATES,
  SHEET_PRESETS,
  builtInIndex,
  fillVariables,
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
