import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPart } from "@/lib/bom-match";

const parts = [
  { id: "r10k", name: "10k resistor", mpn: "RC0603FR-0710KL" },
  { id: "insert", name: "Heat-set insert M3x5", mpn: "" },
  { id: "dup-a", name: "Spacer", mpn: "" },
  { id: "dup-b", name: "spacer", mpn: "" },
];

test("MPN matches exactly, ignoring case", () => {
  assert.equal(matchPart({ name: "whatever", mpn: "rc0603fr-0710kl" }, parts), "r10k");
});

test("rows without an MPN match by name", () => {
  assert.equal(matchPart({ name: " heat-set insert m3x5 ", mpn: "" }, parts), "insert");
});

test("an unknown MPN never falls back to the name — it is a different part", () => {
  assert.equal(matchPart({ name: "10k resistor", mpn: "OTHER-123" }, parts), null);
});

test("ambiguous names stay unmatched", () => {
  assert.equal(matchPart({ name: "Spacer", mpn: "" }, parts), null);
});
