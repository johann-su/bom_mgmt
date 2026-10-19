import { test } from "node:test";
import assert from "node:assert/strict";
import { toSVG } from "bwip-js";
import {
  fittedFontSize,
  labelsCsv,
  renderCode,
  renderLabelSvg,
  renderPages,
} from "@/lib/label-render";
import {
  DEFAULT_TEMPLATES,
  locationVariables,
  type CodeElement,
  type LabelTemplate,
  type TextElement,
} from "@/lib/label-template";

const vars = locationVariables(
  [
    { id: "s", label: "A", name: "", type: { name: "Shelf" } },
    { id: "x", label: "IV", name: "Nuts & <bolts>", type: { name: "Bin" } },
  ],
  { url: "https://inv.example/locations/x" },
);

const text = (over: Partial<TextElement> = {}): TextElement => ({
  id: "t", kind: "text", x: 0, y: 0, w: 20, h: 10, text: "{{code}}",
  fontSize: 12, bold: false, mono: false, align: "start", fit: false, ...over,
});

test("labels are sized in real millimetres so they print at true size", () => {
  const { body } = renderLabelSvg(DEFAULT_TEMPLATES[0].template, vars);
  assert.match(body, /width="40mm" height="20mm" viewBox="0 0 40 20"/);
});

test("variables are filled in and XML-escaped", () => {
  const template: LabelTemplate = {
    width: 40, height: 20, layout: { kind: "single" }, elements: [text({ text: "{{name}}" })],
  };
  const { body } = renderLabelSvg(template, vars);
  assert.ok(body.includes("Nuts &#38; &#60;bolts&#62;"));
  assert.ok(!body.includes("<bolts>"));
});

test("text that evaluates to nothing (empty {{name}}) is left out", () => {
  const template: LabelTemplate = {
    width: 40, height: 20, layout: { kind: "single" }, elements: [text({ text: "{{description}}" })],
  };
  assert.ok(!renderLabelSvg(template, vars).body.includes("<text"));
});

test("fit shrinks long text to the box but never enlarges short text", () => {
  const long = text({ fit: true, w: 10, fontSize: 30 });
  assert.ok(fittedFontSize(long, ["A/1/IV/XXIII"]) < 30 * (25.4 / 72));
  const short = text({ fit: true, w: 100, h: 100, fontSize: 8 });
  assert.equal(fittedFontSize(short, ["A"]), 8 * (25.4 / 72));
  // Without fit the configured size stands, overflow or not.
  assert.equal(fittedFontSize(text({ w: 1, fontSize: 8 }), ["long text"]), 8 * (25.4 / 72));
});

test("2D codes stay square and centred in a non-square box", () => {
  const el: CodeElement = { id: "c", kind: "code", x: 0, y: 0, w: 30, h: 10, symbology: "datamatrix", text: "" };
  const g = renderCode(el, "A/1/IV");
  const [sx, sy] = /scale\(([\d.]+) ([\d.]+)\)/.exec(g)!.slice(1).map(Number);
  assert.equal(sx, sy);
  const tx = Number(/translate\(([\d.]+)/.exec(g)![1]);
  assert.ok(tx > 0, "horizontally centred");
});

test("1D barcodes stretch to fill their box", () => {
  const el: CodeElement = { id: "c", kind: "code", x: 0, y: 0, w: 30, h: 10, symbology: "code128", text: "" };
  const [sx, sy] = /scale\(([\d.]+) ([\d.]+)\)/.exec(renderCode(el, "A/1/IV"))!.slice(1).map(Number);
  assert.notEqual(sx, sy);
});

test("with a printer dot size, Data Matrix modules land on whole dots of the dot grid", () => {
  // 203 dpi thermal head; a 10 mm box would otherwise give ~5.7 dots/module.
  const pixelMm = 25.4 / 203;
  const el: CodeElement = { id: "c", kind: "code", x: 1, y: 1, w: 10, h: 10, symbology: "datamatrix", text: "" };
  const g = renderCode(el, "A/1/IV", pixelMm);
  const [tx, ty, sx] = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)/.exec(g)!.slice(1).map(Number);
  const vw = Number(/viewBox="0 0 (\d+)/.exec(toSVG({ bcid: "datamatrix", text: "A/1/IV", paddingwidth: 0, paddingheight: 0 }))![1]);
  const modules = 14; // A/1/IV encodes as a 14×14 symbol
  const dotsPerModule = (sx * vw) / modules / pixelMm;
  assert.ok(Math.abs(dotsPerModule - Math.round(dotsPerModule)) < 1e-3, `${dotsPerModule} dots/module`);
  assert.ok(sx * vw <= 10, "never larger than its box");
  for (const v of [tx, ty]) assert.ok(Math.abs(v / pixelMm - Math.round(v / pixelMm)) < 0.01);
});

test("with a printer dot size, 1D bars become whole dots wide", () => {
  const pixelMm = 25.4 / 203;
  const el: CodeElement = { id: "c", kind: "code", x: 0, y: 0, w: 30, h: 8, symbology: "code128", text: "" };
  const sx = Number(/scale\(([\d.]+)/.exec(renderCode(el, "A/1/IV", pixelMm))![1]);
  // bwip-js draws 1D codes one SVG unit per module.
  const dots = sx / pixelMm;
  assert.ok(Math.abs(dots - Math.round(dots)) < 1e-3, `${dots} dots/module`);
});

test("content a symbology can't encode is reported, and the rest of the label still renders", () => {
  const template: LabelTemplate = {
    width: 40, height: 20, layout: { kind: "single" },
    elements: [
      // Code 39 has no lowercase letters.
      { id: "c", kind: "code", x: 0, y: 0, w: 20, h: 10, symbology: "code39", text: "{{url}}" },
      text({ y: 10 }),
    ],
  };
  const { body, errors } = renderLabelSvg(template, vars);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Code 39/);
  assert.ok(body.includes("A/IV"));
});

test("renderPages puts a sheet's labels onto as many pages as needed, offset into their cells", () => {
  const template: LabelTemplate = {
    width: 50, height: 20, elements: [text()],
    layout: {
      kind: "sheet", pageWidth: 120, pageHeight: 50, columns: 2, rows: 2,
      marginTop: 5, marginLeft: 10, gapX: 4, gapY: 2,
    },
  };
  const { pages, errors } = renderPages(template, Array(5).fill(vars));
  assert.equal(errors.length, 0);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /width="120mm" height="50mm"/);
  assert.equal(pages[0].match(/<text/g)?.length, 4);
  assert.ok(pages[0].includes('translate(64 27)'));
  assert.equal(pages[1].match(/<text/g)?.length, 1);
});

test("renderPages on a label-printer layout makes one page per label", () => {
  const { pages } = renderPages(DEFAULT_TEMPLATES[0].template, [vars, vars, vars]);
  assert.equal(pages.length, 3);
  assert.match(pages[0], /width="40mm"/);
});

test("labelsCsv exports one row per location for external mail-merge tools", () => {
  const csv = labelsCsv([vars]);
  const [header, row] = csv.trim().split("\r\n");
  assert.ok(header.startsWith("code,label,type,name"));
  assert.ok(row.startsWith("A/IV,IV,Bin,Nuts & <bolts>"));
  assert.equal(labelsCsv([]), "");
});
