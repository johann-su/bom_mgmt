// Generic CSV reading/writing shared by the BOM and parts imports. Accepts what
// spreadsheets and EDA tools tend to produce: `,` or `;` delimiters, a UTF-8
// BOM, CRLF, and quoted fields with embedded newlines. Exports are plain
// RFC 4180 with spreadsheet formula injection neutralized.

export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM (Excel writes one) so the first header still matches.
  const input = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// European spreadsheets export `;`-separated CSV. Decide from the header line:
// whichever delimiter occurs more often outside quotes wins.
function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, "");
  const commas = firstLine.split(",").length;
  const semicolons = firstLine.split(";").length;
  return semicolons > commas ? ";" : ",";
}

function escapeField(value: string): string {
  // Leading =+-@ would run as a formula when the file is opened in a
  // spreadsheet (CSV injection); a leading apostrophe neutralizes it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map((v) => escapeField(String(v))).join(",")).join("\r\n") + "\r\n";
}
