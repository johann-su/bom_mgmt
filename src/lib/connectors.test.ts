import { test } from "node:test";
import assert from "node:assert/strict";
import { genericType } from "@/lib/generic-families";
import { resolveValues, type GeneratedPart, type GenericValues } from "@/lib/generic-parts";

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
  assert.equal(crimp.name, "JST XH crimp contact, female");
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

// Genuine XH/PH are wire-to-board: the board header has the pins. Clone kits
// add male pins and a plug housing for joining cables; JST has no number for
// them, so they get none, and they aren't offered as genuine.
test("male crimp pins and plug housings exist only as generic clone parts", () => {
  const pin = part("jst-xh", { piece: "crimp-m", make: "generic" });
  assert.equal(pin.name, "JST XH crimp contact, male");
  assert.equal(pin.mpn, "");
  assert.equal(attr(pin, "Contact"), "Male (pin)");
  const plug = part("jst-xh", { piece: "plug", make: "generic", pins: "3" });
  assert.equal(plug.name, "JST XH plug housing 3-pin, male");
  assert.equal(plug.mpn, "");
  assert.equal(attr(plug, "Mates with"), "XHP-3");

  const xh = genericType("connectors", "jst-xh")!;
  assert.ok("error" in xh.generate({ piece: "crimp-m", make: "jst" }));
  const pieces = (make: string) => {
    const param = resolveValues(xh, { make }).params.find((p) => p.id === "piece");
    return param?.kind === "select" ? param.options.map((o) => o.value) : [];
  };
  assert.ok(pieces("generic").includes("crimp-m"));
  assert.ok(!pieces("jst").includes("crimp-m"));
  // Switching a male pin to genuine falls back to a piece JST makes.
  assert.equal(resolveValues(xh, { piece: "crimp-m", make: "jst" }).values.piece, "housing");
});
