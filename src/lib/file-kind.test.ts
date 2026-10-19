import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTypeFor, fileKind, isInline } from "@/lib/file-kind";

test("uploads are classified by extension allowlist", () => {
  assert.equal(fileKind("photo.JPG"), "image");
  assert.equal(fileKind("datasheet.pdf"), "document");
  assert.equal(fileKind("evil.html"), null);
  // SVG can carry script, so it is not an allowed image.
  assert.equal(fileKind("logo.svg"), null);
});

test("only images, PDFs and plain text are served inline", () => {
  assert.equal(isInline("a.pdf"), true);
  assert.equal(isInline("a.zip"), false);
  assert.equal(contentTypeFor("noext"), "application/octet-stream");
});
