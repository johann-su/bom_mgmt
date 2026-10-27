import { test } from "node:test";
import assert from "node:assert/strict";
import { genericType, resolveSpec } from "@/lib/generic-families";
import {
  generateRange,
  parseCount,
  parseGenericSpec,
  resolveValues,
  sortRange,
  specFor,
  type GenericType,
} from "@/lib/generic-parts";

const socketHead = genericType("fasteners", "socket-cap")!;
const buttonHead = genericType("fasteners", "iso7380")!;
const xh = genericType("connectors", "jst-xh")!;

test("resolveValues fills defaults and keeps choices the new type still offers", () => {
  // Size defaults to M3 (the select's default), drive and material to the
  // first option.
  assert.deepEqual(resolveValues(socketHead, {}).values, { drive: "iso4762", size: "M3", material: "a2" });
  // ISO 7380 has no M2: switching to it moves the size to its default, while
  // the still-valid material is kept.
  assert.deepEqual(resolveValues(buttonHead, { size: "M2", material: "black" }).values, {
    size: "M3",
    material: "black",
  });
});

test("a choice can remove a parameter: crimp contacts have no pin count", () => {
  const ids = (piece: string) => resolveValues(xh, { piece }).params.map((p) => p.id);
  assert.ok(ids("housing").includes("pins"));
  assert.ok(!ids("crimp").includes("pins"));
});

test("generateRange makes one part per distinct value, in numeric order", () => {
  const parts = generateRange(socketHead, { size: "M3" }, ["10", "6", "10", "8"]);
  assert.ok(Array.isArray(parts));
  // Numeric, not string order: 6 < 8 < 10.
  assert.deepEqual(parts.map((p) => p.part.name), [
    "Socket head cap screw M3×6 A2-70",
    "Socket head cap screw M3×8 A2-70",
    "Socket head cap screw M3×10 A2-70",
  ]);
});

test("generateRange without a range parameter makes exactly one part", () => {
  const nut = genericType("fasteners", "iso4032")!;
  const parts = generateRange(nut, { size: "M4" }, ["8", "12"]);
  assert.ok(Array.isArray(parts) && parts.length === 1);
  const crimp = generateRange(xh, { piece: "crimp" }, []);
  assert.ok(Array.isArray(crimp) && crimp.length === 1);
});

test("generateRange rejects an empty range, out-of-range values and junk (it runs on client input)", () => {
  assert.ok("error" in generateRange(socketHead, {}, []));
  assert.ok("error" in generateRange(xh, { piece: "housing" }, ["4", "99"]), "XH stops at 20 pins");
  assert.ok("error" in generateRange(socketHead, {}, ["8; drop table"]));
  const tooMany = Array.from({ length: 51 }, (_, i) => String(i + 1));
  assert.ok("error" in generateRange(socketHead, {}, tooMany));
});

test("an invalid select value falls back instead of producing a bogus part", () => {
  const type: GenericType = { ...socketHead };
  const parts = generateRange(type, { size: "M99", material: "unobtainium" }, ["8"]);
  assert.ok(Array.isArray(parts));
  assert.equal(parts[0].part.name, "Socket head cap screw M3×8 A2-70");
});

test("sortRange and parseCount", () => {
  assert.deepEqual(sortRange(["12", "3", "12", "5.7"]), ["3", "5.7", "12"]);
  assert.equal(parseCount(" 4 ", 2, 20), "4");
  for (const bad of ["1", "21", "4.5", "-3", "", "four"]) assert.equal(parseCount(bad, 2, 20), null, bad);
});

test("a head shape that comes in several drives picks its standard by drive", () => {
  const pan = genericType("fasteners", "pan")!;
  const drives = resolveValues(pan, {}).params.find((p) => p.id === "drive");
  assert.ok(drives && drives.kind === "select");
  assert.deepEqual(drives.options.map((o) => o.value), ["iso7045h", "iso7045z", "iso14583"]);
  const parts = generateRange(pan, { drive: "iso14583" }, ["8"]);
  assert.ok(Array.isArray(parts));
  assert.equal(parts[0].part.mpn, "ISO 14583 M3x8 A2-70");
  // Switching to Phillips drops a material it isn't made in.
  assert.equal(resolveValues(pan, { drive: "iso7045h", material: "black" }).values.material, "a2");
});

// Each bulk-created part stores the choice it came from, range value
// included, so editing it reopens the wizard on exactly that part.
test("generateRange reports the values behind each part, and specFor keeps only the type's own", () => {
  const parts = generateRange(socketHead, { size: "M4", material: "black", pins: "4" }, ["8", "12"]);
  assert.ok(Array.isArray(parts));
  const spec = specFor("fasteners", socketHead, parts[1].values);
  // "pins" was left over from a connector in the wizard; a screw has none.
  assert.deepEqual(spec, {
    family: "fasteners",
    type: "socket-cap",
    values: { drive: "iso4762", size: "M4", material: "black", length: "12" },
  });
  assert.deepEqual(resolveSpec(spec)?.values, spec.values);
});

// A stale spec must not resolve: resolveValues would swap in defaults and a
// refill would silently change the part (another material, another size).
test("resolveSpec rejects specs the wizard can no longer offer exactly", () => {
  const ok = { drive: "iso4762", size: "M3", material: "a2", length: "8" };
  assert.ok(resolveSpec({ family: "fasteners", type: "socket-cap", values: ok }));
  const stale = (values: Record<string, string>, type = "socket-cap") =>
    resolveSpec({ family: "fasteners", type, values }) === null;
  assert.ok(stale(ok, "renamed-type"), "unknown type");
  assert.ok(stale({ ...ok, material: "titanium" }), "unknown option");
  assert.ok(stale({ ...ok, length: "8; drop" }), "invalid range value");
  assert.ok(stale({ drive: "iso4762", size: "M3", material: "a2" }), "missing length");
  assert.ok(stale({ ...ok, pins: "4" }), "a parameter the type doesn't have");
  // A crimp contact has no pin count, so its spec has no "pins".
  assert.ok(resolveSpec({ family: "connectors", type: "jst-xh", values: { piece: "crimp", make: "generic" } }));
});

test("parseGenericSpec keeps well-formed specs and drops anything else (it's client input)", () => {
  const spec = { family: "fasteners", type: "socket-cap", values: { size: "M3" } };
  assert.deepEqual(parseGenericSpec(spec), spec);
  for (const bad of [null, "x", {}, { ...spec, family: "" }, { ...spec, values: { size: 3 } }, { ...spec, values: ["M3"] }]) {
    assert.equal(parseGenericSpec(bad), null, JSON.stringify(bad));
  }
});
