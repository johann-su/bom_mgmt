import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guessPartMapping,
  planPartImport,
  readPartCsv,
  sanitizeMapping,
  summarizePlan,
  type KnownLocation,
  type KnownPart,
} from "@/lib/part-csv";

const LOCATIONS: KnownLocation[] = [
  { id: "loc-a1", code: "A/1", path: "Shelf A › Box 1" },
  { id: "loc-b", code: "B", path: "Drawer B" },
];

function plan(csv: string, parts: KnownPart[] = []) {
  const table = readPartCsv(csv);
  return planPartImport(table, guessPartMapping(table.headers), { parts, locations: LOCATIONS });
}

test("DigiKey order export: 'Manufacturer Part Number' wins over DigiKey's own 'Part Number'", () => {
  const { headers } = readPartCsv(
    "Index,Quantity,Part Number,Manufacturer Part Number,Description\n1,10,296-1-ND,NE555P,Timer\n",
  );
  const mapping = guessPartMapping(headers);
  assert.equal(headers[mapping.mpn!], "Manufacturer Part Number");
  assert.equal(headers[mapping.description!], "Description");
});

test("LCSC's misspelt 'Manufacture Part Number' and Mouser's 'Mfr. #' are recognised", () => {
  assert.equal(guessPartMapping(["LCSC Part Number", "Manufacture Part Number"]).mpn, 1);
  assert.equal(guessPartMapping(["Mouser #", "Mfr. #"]).mpn, 1);
});

test("a row needs a name or an MPN; an MPN-only row is named after its MPN", () => {
  const result = plan("MPN,Notes\nNE555P,\n,orphan note\n");
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].values, { mpn: "NE555P" });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 3);
});

test("without a Name or MPN column nothing can be identified", () => {
  const result = plan("Description,Qty\nTimer,5\n");
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 1);
});

test("empty cells are left out, so they never overwrite existing data", () => {
  const result = plan("Name,MPN,Manufacturer,Description\nTimer,NE555P,,\n", [
    { id: "p1", name: "555", mpn: "ne555p" },
  ]);
  assert.deepEqual(result.rows[0].target, { existing: "p1" }, "MPN match ignores case");
  assert.deepEqual(result.rows[0].values, { name: "Timer", mpn: "NE555P" });
});

test("an unknown MPN adopts a hand-entered part with the same name and no MPN yet", () => {
  const result = plan("Name,MPN\nM3 insert,IN-M3-5\n", [{ id: "p1", name: "m3 insert", mpn: "" }]);
  assert.deepEqual(result.rows[0].target, { existing: "p1" });
});

test("an unknown MPN does not take over a same-named part that has a different MPN", () => {
  // "10k resistor" from another manufacturer is a different part.
  const result = plan("Name,MPN\n10k resistor,RC0603-10K\n", [
    { id: "p1", name: "10k resistor", mpn: "CRCW060310K0" },
  ]);
  assert.ok("created" in result.rows[0].target);
});

test("a name-only row matching several parts is refused rather than guessed", () => {
  const result = plan("Name\nScrew\n", [
    { id: "p1", name: "Screw", mpn: "" },
    { id: "p2", name: "screw", mpn: "" },
  ]);
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0].message, /MPN/);
});

test("the same part in two bins: the first row creates it, the second only books stock", () => {
  const result = plan("Name,MPN,Location,Qty\nTimer,NE555P,A/1,10\nTimer,ne555p,Drawer B,5\n");
  assert.deepEqual(result.rows[0].target, { created: 0 });
  assert.deepEqual(result.rows[1].target, { created: 0 });
  assert.deepEqual(result.rows[0].stock, { locationId: "loc-a1", quantity: 10 });
  assert.deepEqual(result.rows[1].stock, { locationId: "loc-b", quantity: 5 }, "location by path works too");
  assert.deepEqual(summarizePlan(result), { created: 1, updated: 0, stock: 2, errors: 0 });
});

test("quantities from spreadsheets: thousands separators and '.0' are accepted, fractions aren't", () => {
  const ok = plan("Name,Location,Qty\nWire,a/1,\"1,000\"\nSolder,B,25.0\n");
  assert.deepEqual(ok.rows.map((r) => r.stock?.quantity), [1000, 25]);
  const bad = plan("Name,Location,Qty\nWire,A/1,2.5\n");
  assert.equal(bad.rows.length, 0);
});

test("unknown location and quantity-without-location are row errors", () => {
  const result = plan("Name,Location,Qty\nA,Z/9,1\nB,,4\nC,A/1,\n");
  assert.deepEqual(
    result.errors.map((e) => e.line),
    [2, 3],
  );
  assert.deepEqual(result.rows[0].stock, { locationId: "loc-a1", quantity: 0 }, "location alone = home at 0");
});

test("an order export's Qty is ignored when no location column is mapped", () => {
  const result = plan("MPN,Qty\nNE555P,10\n");
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].stock, null);
});

test("min stock and order link are validated like the part form does", () => {
  const result = plan("Name,Min stock,URL\nA,two,\nB,,javascript:alert(1)\nC,3,lcsc.com/x\n");
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.rows[0].values, { name: "C", minStock: 3, orderUrl: "https://lcsc.com/x" });
});

test("a client-sent mapping is clamped to real, distinct columns", () => {
  assert.deepEqual(sanitizeMapping({ name: 0, mpn: 0, notes: 7, unit: -1, category: "1" }, 3), { name: 0 });
  assert.deepEqual(sanitizeMapping(null, 3), {});
});
