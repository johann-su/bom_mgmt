/**
 * Pastes `text` into a list of per-row names starting at `index`, one line
 * per row — so a column copied from a spreadsheet or a list typed elsewhere
 * ("Gridfinity 1x1", "Gridfinity 1x2", …) fills the rows below the field it
 * was pasted into. Returns null for single-line text, which the field should
 * take as an ordinary paste. The result may be longer than `names`; the
 * caller decides whether to grow the row count to fit.
 */
export function pasteNames(names: string[], index: number, text: string): string[] | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split(/\n|\t/);
  if (lines.length < 2) return null;
  const out = names.slice();
  while (out.length < index) out.push("");
  lines.forEach((line, i) => {
    out[index + i] = line.trim();
  });
  return out;
}
