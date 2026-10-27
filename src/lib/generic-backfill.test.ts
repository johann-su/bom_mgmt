import { test } from "node:test";
import assert from "node:assert/strict";
import { genericType } from "@/lib/generic-families";
import { allCombinations, backfillSql, matchGenericPart, type BackfillPart } from "@/lib/generic-backfill";
import type { GenericValues } from "@/lib/generic-parts";

const combinations = allCombinations();

function made(family: string, type: string, values: GenericValues): BackfillPart {
  const part = genericType(family, type)!.generate(values);
  assert.ok(!("error" in part));
  return { id: "p1", name: part.name, mpn: part.mpn, manufacturer: part.manufacturer };
}

test("a wizard-made part gets back exactly the choice it was made from", () => {
  const values = { drive: "iso4762", size: "M3", material: "black", length: "8" };
  const match = matchGenericPart(made("fasteners", "socket-cap", values), combinations);
  assert.equal(match.kind, "exact");
  assert.ok(match.kind === "exact");
  assert.deepEqual(match.spec, { family: "fasteners", type: "socket-cap", values });
});

// Lengths typed into "other length" aren't among the chips; the number in
// the name is tried as the range value.
test("an uncommon range value is found from the name", () => {
  const match = matchGenericPart(made("fasteners", "heatset", { size: "M3", material: "brass", length: "5.7" }), combinations);
  assert.ok(match.kind === "exact");
  assert.equal(match.spec.values.length, "5.7");
});

// Genuine JST and a clone share the MPN and the name; the manufacturer
// ("JST" vs "") tells them apart.
test("genuine and clone JST parts are told apart by manufacturer", () => {
  for (const make of ["jst", "generic"]) {
    const match = matchGenericPart(made("connectors", "jst-xh", { piece: "housing", make, pins: "4" }), combinations);
    assert.ok(match.kind === "exact", make);
    assert.equal(match.spec.values.make, make);
  }
});

test("a renamed part still matches by MPN + manufacturer; a hand-made part matches nothing", () => {
  const renamed = { ...made("fasteners", "socket-cap", { drive: "iso4762", size: "M3", material: "a2", length: "8" }), name: "M3x8 screws" };
  const match = matchGenericPart(renamed, combinations);
  assert.equal(match.kind, "mpn");
  // Dupont parts have no MPN, so a renamed one can't be recovered: left alone.
  const dupont = { ...made("connectors", "dupont", { piece: "crimp-f" }), name: "Dupont pins" };
  assert.equal(matchGenericPart(dupont, combinations).kind, "none");
  const timer = { id: "p2", name: "NE555 timer", mpn: "NE555P", manufacturer: "TI" };
  assert.equal(matchGenericPart(timer, combinations).kind, "none");
});

test("the SQL only fills parts without a spec and quotes safely", () => {
  const sql = backfillSql([{ id: "p'1", spec: { family: "f", type: "t", values: { a: "it's" } } }]);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /WHERE id = 'p''1' AND generic IS NULL;/);
  assert.match(sql, /'\{"family":"f","type":"t","values":\{"a":"it''s"\}\}'::jsonb/);
  assert.match(sql, /COMMIT;\n$/);
});
