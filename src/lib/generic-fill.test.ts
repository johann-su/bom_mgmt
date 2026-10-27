import { test } from "node:test";
import assert from "node:assert/strict";
import { genericType } from "@/lib/generic-families";
import type { GeneratedPart, GenericValues } from "@/lib/generic-parts";
import { applyGenerated, type GenericFillInput } from "@/lib/generic-fill";

function screw(values: GenericValues): GeneratedPart {
  const part = genericType("fasteners", "socket-cap")!.generate({ drive: "iso4762", size: "M3", material: "a2", length: "8", ...values });
  assert.ok(!("error" in part));
  return part;
}

// The form as the wizard left it after filling `part`.
const filled = (part: GeneratedPart): GenericFillInput => ({
  fields: { name: part.name, description: part.description, manufacturer: part.manufacturer, mpn: part.mpn, unit: part.unit },
  icon: part.icon,
  attributes: part.attributes,
});
const attr = (form: GenericFillInput, key: string) => form.attributes.find((a) => a.key === key)?.value;

test("a first fill replaces the text fields, even typed ones — the user just picked the part", () => {
  const next = screw({ material: "a2" });
  const form = { ...filled(next), fields: { ...filled(next).fields, name: "something typed" } };
  const result = applyGenerated(form, null, next);
  assert.equal(result.fields.name, next.name);
  assert.deepEqual(result.kept, []);
});

// The reason specs are stored: change one select when editing, and every
// field the wizard wrote follows it.
test("changing the material on refill updates name, MPN and the Material attribute", () => {
  const before = screw({ material: "a2" });
  const after = screw({ material: "black" });
  const result = applyGenerated(filled(before), before, after);
  assert.equal(result.fields.name, "Socket head cap screw M3×8 12.9 black");
  assert.equal(result.fields.mpn, "ISO 4762 M3x8 12.9 black");
  assert.match(attr(result, "Material") ?? "", /black oxide/);
  assert.deepEqual(result.kept, []);
});

test("a field edited by hand since the last fill is kept and reported", () => {
  const before = screw({ material: "a2" });
  const form = filled(before);
  form.fields.name = "M3×8 screws, drawer 4";
  const result = applyGenerated(form, before, screw({ material: "black" }));
  assert.equal(result.fields.name, "M3×8 screws, drawer 4");
  assert.deepEqual(result.kept, ["name"]);
  assert.match(result.fields.mpn, /black/, "untouched fields still follow");
});

test("attributes: stale generated ones go, the user's own stay", () => {
  const before = screw({ material: "a2" });
  const nut = genericType("fasteners", "iso4032")!.generate({ size: "M3", material: "a2" });
  assert.ok(!("error" in nut));
  const form = filled(before);
  form.attributes = [...form.attributes, { key: "Bin", value: "A4" }];
  const result = applyGenerated(form, before, nut);
  // A screw turned into a nut has no length or head; "Bin" was the user's.
  assert.equal(attr(result, "Length"), undefined);
  assert.equal(attr(result, "Head Ø"), undefined);
  assert.equal(attr(result, "Bin"), "A4");
  assert.ok(attr(result, "Width across flats"));
});

test("a hand-picked icon is kept; one the wizard set follows the new part", () => {
  const before = screw({});
  const nut = genericType("fasteners", "iso4032")!.generate({ size: "M3", material: "a2" });
  assert.ok(!("error" in nut));
  assert.equal(applyGenerated(filled(before), before, nut).icon, nut.icon);
  assert.equal(applyGenerated({ ...filled(before), icon: "custom/icon" }, before, nut).icon, "custom/icon");
});
