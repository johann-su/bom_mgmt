import { test } from "node:test";
import assert from "node:assert/strict";
import { genericType } from "@/lib/generic-families";
import type { GeneratedPart, GenericValues } from "@/lib/generic-parts";

function part(type: string, values: GenericValues): GeneratedPart {
  const result = genericType("connectors", type)!.generate(values);
  if ("error" in result) assert.fail(result.error);
  return result;
}
const attr = (p: GeneratedPart, key: string) => p.attributes.find((a) => a.key === key)?.value;

test("a JST XH housing carries JST's part number and what it mates with", () => {
  const housing = part("jst-xh", { piece: "housing", make: "generic", pins: "4" });
  assert.equal(housing.name, "JST XH housing 4-pin");
  assert.equal(housing.mpn, "XHP-4");
  // Generic clones keep JST's number as the designation (BOMs list it) but
  // no manufacturer.
  assert.equal(housing.manufacturer, "");
  assert.match(housing.description, /XHP-4-compatible/);
  assert.equal(attr(housing, "Mates with"), "B4B-XH-A / S4B-XH-A");
  assert.equal(attr(housing, "Contacts"), "SXH-001T-P0.6");
  assert.equal(attr(housing, "Pitch"), "2.5 mm");
  assert.equal(housing.icon, "connector/faces/jst-xh");
});

test("genuine JST parts name the manufacturer", () => {
  const header = part("jst-ph", { piece: "header", make: "jst", pins: "2" });
  assert.equal(header.manufacturer, "JST");
  assert.equal(header.mpn, "B2B-PH-K-S");
  assert.equal(attr(header, "Mates with"), "PHR-2");
});

test("SH/GH part numbers zero-pad the pin count and their headers are SMD", () => {
  const housing = part("jst-sh", { piece: "housing", make: "generic", pins: "4" });
  assert.equal(housing.mpn, "SHR-04V-S-B");
  const header = part("jst-sh", { piece: "header-ra", make: "generic", pins: "4" });
  assert.equal(header.mpn, "SM04B-SRSS-TB");
  assert.equal(attr(header, "Mount"), "SMD");
});

test("a crimp contact has no pin count in its name or attributes", () => {
  const crimp = part("jst-xh", { piece: "crimp", make: "generic" });
  assert.equal(crimp.name, "JST XH crimp contact");
  assert.equal(crimp.mpn, "SXH-001T-P0.6");
  assert.equal(attr(crimp, "Pins"), undefined);
});

test("pin counts outside a series' range are rejected", () => {
  const vh = genericType("connectors", "jst-vh")!;
  assert.ok("error" in vh.generate({ piece: "housing", make: "generic", pins: "12" }), "VH stops at 11");
  assert.ok("error" in vh.generate({ piece: "housing", make: "generic", pins: "1" }));
});

test("Dupont and pin headers are generic: no MPN, sized by rows × pins per row", () => {
  const housing = part("dupont", { piece: "housing", rows: "2", pins: "5" });
  assert.equal(housing.name, "Dupont housing 2×5");
  assert.equal(housing.mpn, "");
  assert.equal(attr(housing, "Pins"), "10");
  const header = part("pin-header", { gender: "female", angle: "straight", rows: "1", pitch: "2.54", pins: "8" });
  assert.equal(header.name, "Female header 1×8, 2.54 mm");
  assert.equal(header.icon, "connector/variants/socket");
});
