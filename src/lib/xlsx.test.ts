import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { buildXlsx, columnName } from "@/lib/xlsx";

test("columnName follows Excel's bijective base-26 (Z → AA)", () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
});

test("buildXlsx writes a workbook whose sheet holds the cells, escaped and typed", () => {
  const files = unzipSync(buildXlsx([["Name", "Qty"], ["R <1k> & \"C\"", 10]]));
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml"]) {
    assert.ok(files[part], `missing ${part}`);
  }
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  // Text is XML-escaped; numbers stay numeric so Excel doesn't flag them.
  assert.match(sheet, /<t xml:space="preserve">R &lt;1k&gt; &amp; &quot;C&quot;<\/t>/);
  assert.match(sheet, /<c r="B2"><v>10<\/v><\/c>/);
  // Header row is bold (style 1).
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr">/);
});
