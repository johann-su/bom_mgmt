import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBomCsv, parseCsv, toCsv } from "@/lib/bom-csv";

test("quoted fields keep commas, quotes and newlines; CRLF and BOM are tolerated", () => {
  const text = '﻿Name,Notes\r\n"Screw, M3","say ""hi""\nthere"\r\n';
  assert.deepEqual(parseCsv(text), [
    ["Name", "Notes"],
    ["Screw, M3", 'say "hi"\nthere'],
  ]);
});

test("semicolon-delimited files (European Excel) are detected from the header", () => {
  assert.deepEqual(parseCsv("Name;Qty\nNut;4\n"), [["Name", "Qty"], ["Nut", "4"]]);
});

test("toCsv round-trips through parseCsv", () => {
  const rows = [["Name", "Notes"], ["Screw, M3", 'a "b"\nc']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("toCsv neutralizes spreadsheet formulas (CSV injection)", () => {
  assert.equal(toCsv([["=HYPERLINK(\"x\")"]]).trim(), `"'=HYPERLINK(""x"")"`);
});

test("headers are matched by alias in any order", () => {
  const { rows, errors } = parseBomCsv("Qty,Designator,MPN,Value\n2,\"R1,R2\",RC0603-10K,10k\n");
  assert.deepEqual(errors, []);
  assert.equal(rows[0].mpn, "RC0603-10K");
  assert.equal(rows[0].name, "10k");
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].reference, "R1,R2");
});

test("missing quantity means 1 — EDA exports often list one row per designator", () => {
  const { rows } = parseBomCsv("Name,Reference\nLED,D1\nLED,D2\n");
  // Same part twice → merged: a BOM holds each part once.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].reference, "D1, D2");
});

test("bad rows are reported by line and skipped, good rows still import", () => {
  const { rows, errors } = parseBomCsv("Name,Qty\nNut,abc\n,3\nBolt,2\n");
  assert.deepEqual(rows.map((r) => r.name), ["Bolt"]);
  assert.deepEqual(errors.map((e) => e.line), [2, 3]);
});

test("a file without any part column is rejected", () => {
  const { rows, errors } = parseBomCsv("Qty,Price\n1,2\n");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
});
