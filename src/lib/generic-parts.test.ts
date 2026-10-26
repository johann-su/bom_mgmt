import { test } from "node:test";
import assert from "node:assert/strict";
import { genericType } from "@/lib/generic-families";
import { generateRange, parseCount, resolveValues, sortRange, type GenericType } from "@/lib/generic-parts";

const socketHead = genericType("fasteners", "iso4762")!;
const buttonHead = genericType("fasteners", "iso7380")!;
const xh = genericType("connectors", "jst-xh")!;

test("resolveValues fills defaults and keeps choices the new type still offers", () => {
  // Size defaults to M3 (the select's default), material to the first option.
  assert.deepEqual(resolveValues(socketHead, {}).values, { size: "M3", material: "a2" });
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
  assert.deepEqual(parts.map((p) => p.name), [
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
  assert.equal(parts[0].name, "Socket head cap screw M3×8 A2-70");
});

test("sortRange and parseCount", () => {
  assert.deepEqual(sortRange(["12", "3", "12", "5.7"]), ["3", "5.7", "12"]);
  assert.equal(parseCount(" 4 ", 2, 20), "4");
  for (const bad of ["1", "21", "4.5", "-3", "", "four"]) assert.equal(parseCount(bad, 2, 20), null, bad);
});
