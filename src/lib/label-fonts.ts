// Fonts for turning label text into outlines (svg-outline.ts). Labels name
// Helvetica and Courier; Arimo and Cousine (SIL OFL, in public/fonts) are
// metric-compatible stand-ins that can be bundled. Each family is split into
// Latin, Latin Extended and Greek subset files (as published by Fontsource);
// a character uses the first file that has it, so "Bin Ä", "10 kΩ" and
// "µF" all outline.

import * as opentype from "opentype.js";
import { flattenPath } from "@/lib/svg-geometry";
import type { TextOutliner } from "@/lib/svg-outline";

type Font = opentype.Font;
type Glyph = opentype.Glyph;
export type FontSet = Record<"sans" | "mono", Record<"regular" | "bold", Font[]>>;

const subsets = (family: string, weight: number) =>
  ["latin", "latin-ext", "greek"].map((s) => `${family}-${s}-${weight}-normal.woff`);

/** Served from /fonts; read from public/fonts in tests. */
export const FONT_FILES: Record<keyof FontSet, Record<"regular" | "bold", string[]>> = {
  sans: { regular: subsets("arimo", 400), bold: subsets("arimo", 700) },
  mono: { regular: subsets("cousine", 400), bold: subsets("cousine", 700) },
};

// The ESM build has a named `parse`, the CommonJS one (Node) only a default.
const parseFont: (buffer: ArrayBuffer) => Font =
  (opentype as { parse?: typeof opentype.parse }).parse ??
  (opentype as unknown as { default: typeof opentype }).default.parse;

export async function loadFontSet(read: (file: string) => Promise<ArrayBuffer>): Promise<FontSet> {
  const load = (files: string[]) => Promise.all(files.map(async (f) => parseFont(await read(f))));
  const [sansRegular, sansBold, monoRegular, monoBold] = await Promise.all([
    load(FONT_FILES.sans.regular),
    load(FONT_FILES.sans.bold),
    load(FONT_FILES.mono.regular),
    load(FONT_FILES.mono.bold),
  ]);
  return { sans: { regular: sansRegular, bold: sansBold }, mono: { regular: monoRegular, bold: monoBold } };
}

let browserFonts: Promise<FontSet> | null = null;

/** The fonts in the browser, fetched once on first use. */
export function loadLabelFonts(): Promise<FontSet> {
  browserFonts ??= loadFontSet(async (file) => {
    const res = await fetch(`/fonts/${file}`);
    if (!res.ok) throw new Error(`Couldn't load font ${file}`);
    return res.arrayBuffer();
  }).catch((err) => {
    browserFonts = null;
    throw err;
  });
  return browserFonts;
}

/** Lays out a run glyph by glyph (with kerning) and returns its outlines. */
export function textOutliner(fonts: FontSet): TextOutliner {
  return (run, tolerance) => {
    const candidates = fonts[run.mono ? "mono" : "sans"][run.bold ? "bold" : "regular"];
    const placed: { glyph: Glyph; x: number }[] = [];
    let x = 0;
    let prev = null as { font: Font; glyph: Glyph } | null;
    for (const char of run.text) {
      const font = candidates.find((f) => f.charToGlyphIndex(char) > 0) ?? candidates[0];
      const glyph = font.charToGlyph(char);
      const scale = run.size / font.unitsPerEm;
      if (prev?.font === font) x += font.getKerningValue(prev.glyph, glyph) * scale;
      // A character no font has takes its space but draws no "tofu" box.
      if (glyph.index > 0) placed.push({ glyph, x });
      x += (glyph.advanceWidth ?? 0) * scale;
      prev = { font, glyph };
    }
    const start = run.x - (run.anchor === "middle" ? x / 2 : run.anchor === "end" ? x : 0);
    const outlines = placed.flatMap(({ glyph, x: gx }) =>
      flattenPath(glyph.getPath(start + gx, run.y, run.size).toPathData(4), tolerance).map((l) => ({
        ...l,
        closed: true,
      })),
    );
    return { outlines, advance: x };
  };
}
