import { test } from "node:test";
import assert from "node:assert/strict";
import { pasteNames } from "@/lib/bulk-names";

test("pasteNames fills rows from the pasted field downwards", () => {
  // Pasting into row 1 keeps row 0 and overwrites the rows below.
  assert.deepEqual(pasteNames(["Lid", "", "", "old"], 1, "1x1\n1x2\n"), ["Lid", "1x1", "1x2", "old"]);
});

test("pasteNames grows past the end so the caller can add rows", () => {
  assert.deepEqual(pasteNames([""], 0, "a\r\nb\r\nc"), ["a", "b", "c"]);
});

test("pasteNames treats a spreadsheet row (tabs) like lines and trims each name", () => {
  assert.deepEqual(pasteNames([], 0, " 1x1 \t1x2"), ["1x1", "1x2"]);
});

test("pasteNames leaves single-line pastes to the input", () => {
  // A trailing newline alone doesn't make it a list.
  assert.equal(pasteNames(["", ""], 0, "Fasteners\n"), null);
});
