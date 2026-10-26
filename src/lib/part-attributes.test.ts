import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeAttributes, normalizeAttributes } from "@/lib/part-attributes";

test("attributes are trimmed, keyless rows dropped, keys de-duplicated case-insensitively", () => {
  assert.deepEqual(
    normalizeAttributes([
      { key: " Thread ", value: " M3 " },
      { key: "", value: "orphan" },
      { key: "thread", value: "M4" },
      { key: "Length", value: "5 mm" },
    ]),
    [
      { key: "Thread", value: "M4" },
      { key: "Length", value: "5 mm" },
    ],
  );
});

test("non-array input yields no attributes", () => {
  assert.deepEqual(normalizeAttributes("Thread=M3"), []);
});

// The CSV import merges rather than replaces, so a sheet with just a "Package"
// column doesn't wipe a part's hand-entered "Thread".
test("mergeAttributes updates matching keys in place and keeps the rest", () => {
  assert.deepEqual(
    mergeAttributes(
      [
        { key: "Thread", value: "M3" },
        { key: "Length", value: "5 mm" },
      ],
      [
        { key: "length", value: "8 mm" },
        { key: "Package", value: "bag" },
      ],
    ),
    [
      { key: "Thread", value: "M3" },
      { key: "Length", value: "8 mm" },
      { key: "Package", value: "bag" },
    ],
  );
});
