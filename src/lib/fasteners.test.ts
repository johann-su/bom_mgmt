import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commonLengths,
  FASTENER_TYPES,
  fastenerSizes,
  fastenerType,
  generateFastener,
  materialsFor,
  parseLength,
} from "@/lib/fasteners";
import type { GeneratedPart } from "@/lib/generic-parts";
import { isIconAttribute } from "@/lib/part-attributes";

function ok(result: GeneratedPart | { error: string }): GeneratedPart {
  if ("error" in result) assert.fail(result.error);
  return result;
}
const attr = (part: GeneratedPart, key: string) => part.attributes.find((a) => a.key === key)?.value;

test("a socket head cap screw gets its name, ISO designation as MPN, and head specs", () => {
  const part = ok(generateFastener({ type: "iso4762", size: "M3", length: 8, material: "a2" }));
  assert.equal(part.name, "Socket head cap screw M3×8 A2-70");
  // ASCII "x" in the MPN so it can be typed and matched from a BOM.
  assert.equal(part.mpn, "ISO 4762 M3x8 A2-70");
  assert.match(part.description, /ISO 4762 \(DIN 912\)/);
  assert.match(part.description, /stainless steel A2 \(A2-70\)/);
  assert.deepEqual(part.category, ["Fasteners", "Screws"]);
  // The side view, not the drive, is the thumbnail.
  assert.equal(part.icon, "screw/heads-sideways/machine/socket-cap");
  assert.equal(part.unit, "pcs");
  assert.equal(attr(part, "Thread"), "M3");
  assert.equal(attr(part, "Pitch"), "0.5 mm");
  assert.equal(attr(part, "Length"), "8 mm");
  assert.equal(attr(part, "Head Ø"), "5.5 mm");
  assert.equal(attr(part, "Drive"), "Hex socket 2.5 mm");
});

test("nuts and washers have no length and describe their own geometry", () => {
  // A length passed for a nut is ignored, not put in the name.
  const nut = ok(generateFastener({ type: "iso4032", size: "M3", length: 8, material: "zinc" }));
  assert.equal(nut.name, "Hex nut M3 zinc");
  assert.equal(attr(nut, "Length"), undefined);
  assert.equal(attr(nut, "Width across flats"), "5.5 mm");

  const washer = ok(generateFastener({ type: "iso7089", size: "M3", material: "a2" }));
  assert.equal(washer.mpn, "ISO 7089 M3 A2");
  assert.equal(attr(washer, "Fits"), "M3");
  assert.equal(attr(washer, "Inner Ø"), "3.2 mm");
  assert.equal(attr(washer, "Thread"), undefined);
});

test("heat-set inserts have no standard, so no MPN to match on", () => {
  const insert = ok(generateFastener({ type: "heatset", size: "M3", length: 5.7, material: "brass" }));
  assert.equal(insert.name, "Heat-set insert M3×5.7 brass");
  assert.equal(insert.mpn, "");
  assert.equal(attr(insert, "Standard"), undefined);
  // The grade adds nothing to "Brass", so it isn't repeated.
  assert.equal(attr(insert, "Material"), "Brass");
});

test("specs outside the standard are rejected rather than invented", () => {
  // ISO 7380 starts at M3.
  assert.ok("error" in generateFastener({ type: "iso7380", size: "M2", length: 6, material: "a2" }));
  // Heat-set inserts only come in brass.
  assert.ok("error" in generateFastener({ type: "heatset", size: "M3", length: 5, material: "a2" }));
  assert.ok("error" in generateFastener({ type: "iso4762", size: "M3", material: "a2" }), "screw without length");
  assert.ok("error" in generateFastener({ type: "nope", size: "M3", material: "a2" }));
});

test("every type × size × offered material generates", () => {
  // Guards the data tables: a missing dimension or pitch would show as NaN.
  for (const type of FASTENER_TYPES) {
    for (const size of fastenerSizes(type)) {
      for (const material of materialsFor(type)) {
        const part = ok(generateFastener({ type: type.id, size, length: 10, material: material.id }));
        for (const a of part.attributes) assert.doesNotMatch(a.value, /NaN|undefined/, `${type.id} ${size} ${a.key}`);
      }
    }
  }
});

test("common lengths scale with the thread size", () => {
  const type = fastenerType("iso4762")!;
  const m3 = commonLengths(type, "M3");
  assert.equal(m3[0], 3);
  assert.ok(m3.at(-1)! <= 36);
  assert.ok(commonLengths(type, "M8").includes(80));
  assert.deepEqual(commonLengths(fastenerType("iso4032")!, "M3"), []);
});

test("parseLength accepts mm, decimal commas and a unit, and rejects nonsense", () => {
  assert.equal(parseLength("8"), 8);
  assert.equal(parseLength(" 5,7 "), 5.7);
  assert.equal(parseLength("12 mm"), 12);
  for (const bad of ["", "0", "-3", "abc", "1000", "3.141"]) assert.equal(parseLength(bad), null, bad);
});


test("Torx, Phillips, Pozidriv and slotted heads are their own standards with their own drive sizes", () => {
  const torx = ok(generateFastener({ type: "iso14579", size: "M3", length: 8, material: "a2" }));
  assert.equal(torx.name, "Torx socket head cap screw M3×8 A2-70");
  assert.equal(torx.mpn, "ISO 14579 M3x8 A2-70");
  assert.equal(attr(torx, "Drive"), "Torx T10");

  const phillips = ok(generateFastener({ type: "iso7045h", size: "M4", length: 10, material: "zinc" }));
  assert.equal(attr(phillips, "Drive"), "Phillips PH2");
  // Cross-recessed steel screws are 4.8, not the 8.8 of socket screws.
  assert.equal(phillips.name, "Phillips pan head screw M4×10 4.8 zinc");
  // Phillips (H) and Pozidriv (Z) share ISO 7045; the recess type keeps
  // their designations apart.
  const pozidriv = ok(generateFastener({ type: "iso7045z", size: "M4", length: 10, material: "zinc" }));
  assert.equal(phillips.mpn, "ISO 7045 M4x10 H 4.8 zinc");
  assert.equal(pozidriv.mpn, "ISO 7045 M4x10 Z 4.8 zinc");

  const slotted = ok(generateFastener({ type: "iso1207", size: "M3", length: 6, material: "brass" }));
  assert.equal(attr(slotted, "Drive"), "Slotted 0.8 mm");
  // 12.9 black oxide isn't made with a slot or cross recess.
  assert.ok("error" in generateFastener({ type: "iso7046h", size: "M3", length: 8, material: "black" }));
});

test("fasteners picture themselves in icon-1 (upright), then their drive in icon-2, for bin labels", () => {
  const csk = ok(generateFastener({ type: "iso10642", size: "M3", length: 10, material: "black" }));
  assert.equal(attr(csk, "Head"), "Countersunk");
  // Upright, not the sideways view the thumbnail uses.
  assert.equal(attr(csk, "icon-1"), "screw/heads/machine/countersunk");
  assert.equal(attr(csk, "icon-2"), "screw/drives/hex");
  // A nut is just itself: no icon-2, so a label's drive graphic stays blank.
  const nut = ok(generateFastener({ type: "iso4032", size: "M3", material: "zinc" }));
  assert.equal(attr(nut, "icon-1"), "screw/hardware/nuts/hex-nut");
  assert.equal(attr(nut, "icon-2"), undefined);
});

test("every fastener icon, label pictures included, is in the catalogue", async () => {
  const { loadIcons } = await import("@/lib/label-icons");
  const ids = new Set((await loadIcons()).map((i) => i.id));
  for (const type of FASTENER_TYPES) {
    for (const id of type.icons) assert.ok(ids.has(id), `${type.id}: ${id}`);
    const part = generateFastener({
      type: type.id,
      size: fastenerSizes(type)[0],
      material: materialsFor(type)[0].id,
      length: commonLengths(type, fastenerSizes(type)[0])[0] ?? 10,
    });
    if ("error" in part) assert.fail(`${type.id}: ${part.error}`);
    for (const a of part.attributes.filter((a) => isIconAttribute(a.key))) {
      assert.ok(ids.has(a.value), `${type.id} ${a.key}: ${a.value}`);
    }
  }
});

test("every fastener has a Short name, so one {{attr:Short name}} label fits screws, nuts and washers", () => {
  const size = (type: string, length?: number) =>
    attr(ok(generateFastener({ type, size: "M3", length, material: "a2" })), "Short name");
  assert.equal(size("iso10642", 8), "M3×8");
  assert.equal(size("iso4032"), "M3");
  assert.equal(size("iso7089"), "M3");
  assert.equal(attr(ok(generateFastener({ type: "heatset", size: "M3", length: 5.7, material: "brass" })), "Short name"), "M3×5.7");
});
