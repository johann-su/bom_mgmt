import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidRequest, mutationError } from "@/lib/api/http";
import { StockChangeBody } from "@/lib/api/schemas";

// The mutation core reports failures as { error, code? }; the code alone
// decides the status, so a reworded message can't change what a client sees.
test("mutation errors map to 404 / 409 / 400 by code", async () => {
  const missing = mutationError({ error: "Part not found", code: "not_found" });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "not_found");

  const short = mutationError({ error: "Not enough stock in that location", code: "conflict" });
  assert.equal(short.status, 409);
  assert.equal((await short.json()).code, "conflict");

  // No code: input the core refused (parsePartInput, parseQuantity, …).
  const invalid = mutationError({ error: "Name is required" });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "invalid_request");
});

// Responses are per-key private data and must never land in a shared cache.
test("API responses are never cacheable", () => {
  assert.equal(mutationError({ error: "x" }).headers.get("cache-control"), "no-store");
});

// Validation errors point at the offending field with a dotted path, so a
// client can show them next to its own inputs.
test("validation issues carry the field's path", async () => {
  const parsed = StockChangeBody.safeParse({ mode: "add", location: null, quantity: 0 });
  assert.equal(parsed.success, false);
  const body = await invalidRequest(parsed.error!).json();
  assert.equal(body.code, "invalid_request");
  assert.deepEqual(
    body.issues.map((i: { path: string }) => i.path),
    ["quantity"],
  );
});
