import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildXlsx, columnName, readXlsx } from "@/lib/xlsx";

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

test("readXlsx round-trips buildXlsx's inline strings and numbers", () => {
  const rows = [["Name", "Qty"], ["R <1k> & \"C\"", 10], ["", 2.5]];
  assert.deepEqual(readXlsx(buildXlsx(rows)), [["Name", "Qty"], ["R <1k> & \"C\"", "10"], ["", "2.5"]]);
});

// What Excel itself writes: shared strings (with rich-text runs and phonetic
// hints), sparse cells addressed by ref, booleans, formulas with cached values,
// and the first tab living at a non-default path. SDK-generated files also
// prefix every element (`<x:c>`).
test("readXlsx reads Excel-style shared strings, gaps and the first tab via rels", () => {
  const xml = (s: string) => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${s}`);
  const ns = `xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="r"`;
  const bytes = zipSync({
    "xl/workbook.xml": xml(
      `<x:workbook ${ns}><x:sheets><x:sheet name="Parts" sheetId="7" r:id="rId9"/><x:sheet name="Other" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": xml(
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Target="/xl/worksheets/parts.xml"/></Relationships>`,
    ),
    "xl/sharedStrings.xml": xml(
      `<x:sst ${ns}><x:si><x:t>MPN</x:t></x:si><x:si><x:r><x:t>NE</x:t></x:r><x:r><x:t xml:space="preserve">555 </x:t></x:r><x:rPh><x:t>ignored</x:t></x:rPh></x:si><x:si><x:t>line_x000D_&#10;two</x:t></x:si><x:si><x:t/></x:si></x:sst>`,
    ),
    "xl/worksheets/sheet1.xml": xml(`<x:worksheet ${ns}><x:sheetData><x:row r="1"><x:c r="A1"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>`),
    "xl/worksheets/parts.xml": xml(
      `<x:worksheet ${ns}><x:sheetData>` +
        `<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>2</x:v></x:c></x:row>` +
        `<x:row r="2"><x:c r="A2" t="s" s="3"/><x:c r="B2" t="s"><x:v>3</x:v></x:c></x:row>` + // blank row → dropped
        `<x:row r="4"><x:c r="A4" t="s"><x:v>1</x:v></x:c><x:c r="B4" t="b"><x:v>1</x:v></x:c><x:c r="D4"><x:f>2*5</x:f><x:v>10</x:v></x:c></x:row>` +
        `</x:sheetData></x:worksheet>`,
    ),
  });
  assert.deepEqual(readXlsx(bytes), [
    ["MPN", "", "line\r\ntwo"],
    ["NE555 ", "TRUE", "", "10"],
  ]);
});

test("readXlsx skips a Numbers table title above the sheet's used range", () => {
  const bytes = zipSync({
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="T" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><dimension ref="A2:B3"/><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>Table 1</t></is></c><c r="B1"/></row>` +
        `<row r="2"><c r="A2" t="inlineStr"><is><t>MPN</t></is></c></row>` +
        `</sheetData></worksheet>`,
    ),
  });
  assert.deepEqual(readXlsx(bytes), [["MPN"]]);
});

test("readXlsx throws on a ZIP that isn't a workbook", () => {
  assert.throws(() => readXlsx(zipSync({ "doc.txt": strToU8("hi") })));
  assert.throws(() => readXlsx(strToU8("Name,Qty\nx,1\n")));
});
