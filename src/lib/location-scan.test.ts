import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveScannedLocation } from "@/lib/location-scan";

const ID = "3f1c9a2e-7b4d-4e8a-9c01-5d6e7f8a9b0c";
const loc = (id: string, code: string, path: string, name = "") => ({ id, code, path, name });
const all = [
  loc("a", "A", "Shelf A"),
  loc(ID, "A/1/IV", "Shelf A › Box 1 › Bin IV", "Resistors"),
  loc("a11", "A/11", "Shelf A › Box 11"),
  loc("a1-1", "A1/1", "Shelf A1 › Box 1"),
];
const resolve = (text: string) => resolveScannedLocation(all, text)?.id ?? null;

test("a label holding {{code}} resolves by code, ignoring case (Code 39 is upper-case only)", () => {
  assert.equal(resolve("A/1/IV"), ID);
  assert.equal(resolve("a/1/iv"), ID);
});

test("a label holding {{url}} resolves by the id in the path, whatever the host", () => {
  assert.equal(resolve(`https://bom.example.com/locations/${ID}`), ID);
  assert.equal(resolve(`http://old-host:3000/locations/${ID.toUpperCase()}?from=label`), ID);
});

test("a label holding {{id}} resolves; an unknown id matches nothing rather than falling back", () => {
  assert.equal(resolve(ID), ID);
  assert.equal(resolve("00000000-0000-4000-8000-000000000000"), null);
});

test("{{path}} and a unique {{name}} resolve too", () => {
  assert.equal(resolve("Shelf A › Box 1 › Bin IV"), ID);
  assert.equal(resolve("resistors"), ID);
});

test("mangled separators still resolve, but only when the compact code is unambiguous", () => {
  assert.equal(resolve("A-1-IV"), ID);
  // "A/11" and "A1/1" both compact to "a11": an exact code wins, a mangled one is refused.
  assert.equal(resolve("A/11"), "a11");
  assert.equal(resolve("A-11"), null);
});

test("blank or unrelated text matches nothing", () => {
  assert.equal(resolve("   "), null);
  assert.equal(resolve("Z/9"), null);
});
