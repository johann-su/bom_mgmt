import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTypeFor, fileKind, isInline, remoteFilename } from "@/lib/file-kind";

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

test("a shop's file is named by what it is, with the extension from its content type", () => {
  // LCSC datasheets live at opaque hash URLs; the name comes from the part.
  const url = "https://datasheet.lcsc.com/datasheet/pdf/3dad1d8f.pdf?productCode=C2040";
  assert.equal(remoteFilename("RP2040 datasheet", "application/pdf", url), "RP2040 datasheet.pdf");
  assert.equal(remoteFilename("RP2040", "image/jpeg; charset=binary", "https://x.test/a"), "RP2040.jpg");
  // Path separators and other unsafe characters don't survive into the name.
  assert.equal(remoteFilename("A/B: C", "image/png", "https://x.test/a"), "A-B- C.png");
});

test("a shop's file must really be a PDF or image — an HTML page is refused", () => {
  assert.equal(remoteFilename("x", "text/html", "https://x.test/datasheet.pdf"), null);
  // Generic binary falls back to the URL's extension, but only an allowed one.
  assert.equal(remoteFilename("x", "application/octet-stream", "https://x.test/d.pdf"), "x.pdf");
  assert.equal(remoteFilename("x", "application/octet-stream", "https://x.test/d.html"), null);
});
