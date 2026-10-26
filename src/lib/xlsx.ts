// Minimal .xlsx writer: one sheet, a bold frozen header row, strings as inline
// strings and numbers as numbers. Enough for downloadable import templates
// without pulling in a spreadsheet library — an .xlsx is a ZIP of XML parts.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type XlsxCell = string | number;

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters; Excel refuses the file over them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function cellXml(value: XlsxCell, ref: string, style: number): string {
  const s = style ? ` s="${style}"` : "";
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

/**
 * Builds a workbook whose first row is a header. `widths` are column widths
 * in Excel's character units.
 */
export function buildXlsx(
  rows: XlsxCell[][],
  { sheetName = "Sheet1", widths = [] }: { sheetName?: string; widths?: number[] } = {},
): Uint8Array {
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const sheetRows = rows
    .map((row, r) => {
      // Empty strings stay empty cells rather than zero-length text.
      const cells = row.map((v, c) => (v === "" ? "" : cellXml(v, `${columnName(c)}${r + 1}`, r === 0 ? 1 : 0)));
      return `<row r="${r + 1}">${cells.join("")}</row>`;
    })
    .join("");
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;

  const files: Record<string, string> = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    // Style 0 = default, style 1 = bold (the header row).
    "xl/styles.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])));
}

// --- Reading ------------------------------------------------------------------
// The counterpart for imports: the first worksheet as rows of cell text. Not a
// general XML parser — it reads the handful of SpreadsheetML elements Excel,
// Numbers, LibreOffice and Google Sheets write, tolerating namespace prefixes
// (`<x:c>`) that SDK-generated files use.

const unescapeXml = (s: string) =>
  s
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|quot|apos|amp));/gi, (_, dec, hex, name) =>
      dec
        ? String.fromCodePoint(Number(dec))
        : hex
          ? String.fromCodePoint(parseInt(hex, 16))
          : { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }[name.toLowerCase() as "lt"],
    )
    // Excel escapes characters XML can't hold (e.g. the CR of CRLF) as _xHHHH_.
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const attr = (attrs: string, name: string) =>
  new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`).exec(attrs)?.[1];

/** Every element named `tag` (any prefix): its attribute string and inner XML. */
function* elements(xml: string, tag: string): Generator<[attrs: string, inner: string]> {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, "g");
  for (const m of xml.matchAll(re)) yield [m[1], m[2] ?? ""];
}

// Rich text splits a cell into runs (<r><t>…</t></r>); phonetic hints (<rPh>)
// aren't part of the value.
const richText = (xml: string) =>
  [...elements(xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, ""), "t")]
    .map(([, inner]) => unescapeXml(inner))
    .join("");

/** "B3" → 1 (zero-based column), or undefined when the ref is missing. */
function columnIndex(ref: string | undefined): number | undefined {
  const letters = ref?.match(/^[A-Z]+/i)?.[0];
  if (!letters) return undefined;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/**
 * Reads the first worksheet of an .xlsx as rows of strings, dropping rows that
 * are entirely blank (like parseCsv). Cells hold what the cell stores: the
 * cached result for formulas, numbers as written in the file (dates come out
 * as Excel serial numbers), booleans as TRUE/FALSE. Throws on a file that
 * isn't an .xlsx workbook.
 */
export function readXlsx(bytes: Uint8Array): string[][] {
  // Only the XML parts are needed; skip inflating images and the like.
  const files = unzipSync(bytes, { filter: (f) => /\.(xml|rels)$/.test(f.name) });
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : undefined);

  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new Error("Not an .xlsx workbook");
  // The first <sheet> is the first tab; its r:id points at the part via the rels.
  const [firstSheet] = elements(workbook, "sheet");
  const relId = firstSheet && attr(firstSheet[0], "id");
  let sheetPath = "xl/worksheets/sheet1.xml";
  for (const [attrs] of elements(read("xl/_rels/workbook.xml.rels") ?? "", "Relationship")) {
    if (attr(attrs, "Id") !== relId) continue;
    const target = attr(attrs, "Target") ?? "";
    sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new Error("The workbook has no worksheet");

  const shared = [...elements(read("xl/sharedStrings.xml") ?? "", "si")].map(([, inner]) => richText(inner));

  // Numbers puts the table's name in a merged title row above the header and
  // leaves it out of the sheet's used range (<dimension ref="A2:D5">); rows
  // above that range aren't part of the table.
  const [dimension] = elements(sheet, "dimension");
  const firstRow = Number(attr(dimension?.[0] ?? "", "ref")?.match(/^[A-Z]+(\d+)/i)?.[1] ?? 1);

  const rows: string[][] = [];
  for (const [rowAttrs, rowXml] of elements(sheet, "row")) {
    if (Number(attr(rowAttrs, "r") ?? firstRow) < firstRow) continue;
    const row: string[] = [];
    for (const [attrs, inner] of elements(rowXml, "c")) {
      const value = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let text: string;
      switch (attr(attrs, "t")) {
        case "s":
          text = shared[Number(value)] ?? "";
          break;
        case "inlineStr":
          text = richText(inner);
          break;
        case "b":
          text = value === "1" ? "TRUE" : value === "0" ? "FALSE" : "";
          break;
        default: // n, str (formula text), e (#N/A …), or absent = number
          text = value === undefined ? "" : unescapeXml(value);
      }
      const index = columnIndex(attr(attrs, "r")) ?? row.length;
      while (row.length < index) row.push("");
      row[index] = text;
    }
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}
