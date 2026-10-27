import { test } from "node:test";
import assert from "node:assert/strict";
import type { GraphicElement, LabelTemplate, TextElement } from "@/lib/label-template";
import { parseTemplate } from "@/lib/label-template";
import { fillTemplate } from "@/lib/label-render";
import {
  NO_CONTENTS,
  applyContents,
  fillAttributes,
  labelContents,
  type ContentIcon,
  type ContentPart,
} from "@/lib/label-contents";

const icon = (name: string): ContentIcon => ({ name, markup: `<path id="${name}"/>`, viewBox: [0, 0, 48, 48] });
const catalogue: Record<string, ContentIcon> = {
  "screw/drives/hex": icon("Hex socket"),
  "screw/drives/torx": icon("Torx"),
  "screw/heads-sideways/machine/countersunk": icon("Countersunk"),
};
const lookup = (id: string) => catalogue[id];

const cskHex = (length: string, drive = "screw/drives/hex"): ContentPart => ({
  attributes: [
    { key: "Thread", value: "M3" },
    { key: "Length", value: length },
    { key: "icon-1", value: "screw/heads-sideways/machine/countersunk" },
    { key: "icon-2", value: drive },
  ],
});

const drive: GraphicElement = {
  id: "drive", kind: "graphic", x: 0, y: 0, w: 10, h: 10, attr: "icon-2",
  markup: '<rect id="stand-in"/>', viewBox: [0, 0, 10, 10], stretch: false,
};
const spec: TextElement = {
  id: "t", kind: "text", x: 10, y: 0, w: 20, h: 10, text: "{{attr:Thread}} × {{attr: length }}",
  fontSize: 8, bold: false, mono: false, align: "start", fit: false,
};
const template: LabelTemplate = { width: 30, height: 10, layout: { kind: "single" }, elements: [drive, spec] };

test("a bin of one screw size fills both its icons and attributes", () => {
  const contents = labelContents([cskHex("8 mm")], lookup);
  assert.equal(contents.attributes.thread, "M3");
  assert.equal(contents.icons["icon-1"]?.name, "Countersunk");
  assert.equal(contents.icons["icon-2"]?.name, "Hex socket");
  // Plain text attributes aren't icons, even though they're agreed.
  assert.equal(contents.icons.thread, undefined);
});

test("only what every part agrees on is filled: a range of lengths prints the thread, not a length", () => {
  const contents = labelContents([cskHex("8 mm"), cskHex("10 mm")], lookup);
  assert.equal(contents.attributes.thread, "M3");
  assert.equal(contents.attributes.length, undefined);
  assert.equal(contents.icons["icon-2"]?.name, "Hex socket");
});

test("mixed drives in one bin leave the drive graphic blank", () => {
  const contents = labelContents([cskHex("8 mm"), cskHex("8 mm", "screw/drives/torx")], lookup);
  assert.equal(contents.icons["icon-2"], undefined);
  assert.equal(contents.icons["icon-1"]?.name, "Countersunk");
});

test("a part missing an attribute breaks agreement (nuts next to screws have no common drive)", () => {
  const nut: ContentPart = { attributes: [{ key: "Thread", value: "M3" }] };
  const contents = labelContents([cskHex("8 mm"), nut], lookup);
  assert.equal(contents.attributes.thread, "M3");
  assert.deepEqual(contents.icons, {});
});

test("attribute names match case-insensitively; unknown icon ids are skipped", () => {
  const part: ContentPart = {
    attributes: [
      { key: " thread ", value: " M4 " },
      { key: "icon-1", value: "no/such/icon" },
    ],
  };
  const contents = labelContents([part], lookup);
  assert.equal(fillAttributes("{{ATTR:Thread}}", contents), "M4");
  assert.deepEqual(contents.icons, {});
});

test("a bound graphic takes the contents' icon, and is left off when there's none", () => {
  const filled = applyContents(template, labelContents([cskHex("8 mm")], lookup), {});
  const graphic = filled.elements[0] as GraphicElement;
  assert.match(graphic.markup, /Hex socket/);
  assert.equal(graphic.name, "Hex socket");
  // Box and binding stay — only the drawing changes.
  assert.equal(graphic.w, 10);
  assert.equal(graphic.attr, "icon-2");

  // An empty bin (or nuts, which have no drive) prints no drive at all, not the stand-in.
  const blank = applyContents(template, NO_CONTENTS, {});
  assert.ok(!blank.elements.some((e) => e.id === "drive"));
  assert.equal((blank.elements[0] as TextElement).text, " × ");
});

test("the designer keeps a bound graphic's stand-in so it can still be edited", () => {
  const preview = applyContents(template, NO_CONTENTS, {}, { keepStandIns: true });
  assert.match((preview.elements[0] as GraphicElement).markup, /stand-in/);
});

test("a location's own slot value beats the contents", () => {
  const slotted: LabelTemplate = { ...template, elements: [{ ...drive, slot: "drive" }, spec] };
  const own = { drive: { kind: "graphic" as const, markup: '<circle id="own"/>', viewBox: [0, 0, 1, 1] as [number, number, number, number] } };
  const filled = fillTemplate(slotted, own, labelContents([cskHex("8 mm")], lookup));
  assert.match((filled.elements[0] as GraphicElement).markup, /own/);
  // Hidden by the location stays hidden.
  const hidden = fillTemplate(slotted, { drive: { kind: "none" } }, labelContents([cskHex("8 mm")], lookup));
  assert.ok(!hidden.elements.some((e) => e.id === "drive"));
});

test("without contents (no location data) the template is left as designed", () => {
  assert.deepEqual(fillTemplate(template, undefined, undefined), template);
});

test("a graphic's attribute binding survives a save and load", () => {
  const parsed = parseTemplate({ ...template, elements: [{ ...drive, attr: "  icon-1 " }] });
  assert.ok(!("error" in parsed));
  assert.equal((parsed.elements[0] as GraphicElement).attr, "icon-1");
});
