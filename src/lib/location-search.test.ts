import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLocations } from "@/lib/location-search";

const loc = (id: string, code: string, path: string, name = "") => ({ id, code, path, name });
const all = [
  loc("a", "A", "Shelf A"),
  loc("a1", "A/1", "Shelf A › Box 1", "Fasteners"),
  loc("a1iv", "A/1/IV", "Shelf A › Box 1 › Bin IV"),
  loc("a10", "A/10", "Shelf A › Box 10"),
];

test("codes match with separators ignored — 'a1iv' and 'A-1-IV' find bin A/1/IV", () => {
  assert.equal(matchLocations(all, "a1iv")[0].id, "a1iv");
  assert.equal(matchLocations(all, "A-1-IV")[0].id, "a1iv");
});

test("an exact code ranks before locations it is a prefix of", () => {
  assert.deepEqual(
    matchLocations(all, "A/1").map((l) => l.id),
    ["a1", "a1iv", "a10"],
  );
});

test("names and readable paths are searched too", () => {
  assert.deepEqual(matchLocations(all, "fasten").map((l) => l.id), ["a1"]);
  assert.ok(matchLocations(all, "bin iv").some((l) => l.id === "a1iv"));
});
