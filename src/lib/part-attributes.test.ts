import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAttributes } from "@/lib/part-attributes";

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
