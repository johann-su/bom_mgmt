// Renders label templates (src/lib/label-template.ts) to SVG. Pure string
// building plus bwip-js, which is plain JS, so it runs the same in the
// browser (designer preview, downloads) and under node:test.
//
// Everything is in millimetres: the SVG viewBox is the label (or page) size
// in mm and `width`/`height` carry the "mm" unit, so the file prints at true
// size from any viewer and converts to PDF without scaling (label-export.ts).

import { raw, toSVG } from "bwip-js";
import { toCsv } from "@/lib/bom-csv";
import {
  SYMBOLOGIES,
  fillVariables,
  pageSize,
  placeLabels,
  type CodeElement,
  type LabelTemplate,
  type LabelVariables,
  type TextElement,
} from "@/lib/label-template";

const PT_TO_MM = 25.4 / 72;
const LINE_HEIGHT = 1.2;
// Rough advance width per character in em. There's no font metrics API that
// works in Node and every PDF viewer alike, so "fit" errs towards shrinking.
const CHAR_WIDTH = { mono: 0.6, bold: 0.62, regular: 0.56 };
// Baseline offset from the top of a line box, in em (≈ ascent of Helvetica).
const ASCENT = 0.8;

export const FONT_SANS = "Helvetica, Arial, sans-serif";
export const FONT_MONO = "Courier, monospace";

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const n = (value: number) => +value.toFixed(3);

/** Font size in mm a text element is drawn at, after shrink-to-fit. */
export function fittedFontSize(el: TextElement, lines: string[]): number {
  const size = el.fontSize * PT_TO_MM;
  if (!el.fit) return size;
  const perChar = el.mono ? CHAR_WIDTH.mono : el.bold ? CHAR_WIDTH.bold : CHAR_WIDTH.regular;
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const byWidth = el.w / (longest * perChar);
  const byHeight = el.h / (lines.length * LINE_HEIGHT);
  return Math.min(size, byWidth, byHeight);
}

function renderText(el: TextElement, vars: Partial<LabelVariables>): string {
  const lines = fillVariables(el.text, vars).split("\n");
  if (lines.every((l) => !l.trim())) return "";
  const size = fittedFontSize(el, lines);
  // Centre the block of lines vertically in the box.
  const top = el.y + (el.h - lines.length * size * LINE_HEIGHT) / 2;
  const x = el.align === "start" ? el.x : el.align === "middle" ? el.x + el.w / 2 : el.x + el.w;
  const attrs = [
    `font-family="${el.mono ? FONT_MONO : FONT_SANS}"`,
    `font-size="${n(size)}"`,
    el.bold ? `font-weight="bold"` : "",
    `text-anchor="${el.align}"`,
    `fill="#000"`,
  ].filter(Boolean);
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${n(x)}" y="${n(top + (i * LINE_HEIGHT + ASCENT) * size)}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text ${attrs.join(" ")} xml:space="preserve">${tspans}</text>`;
}

/**
 * Draws a code into its box. 2D codes keep their aspect ratio (a squashed
 * Data Matrix won't scan) and sit centred; 1D barcodes stretch to fill, which
 * only changes bar height and overall width — the bar ratios survive.
 *
 * With `pixelMm` (the size of one printer dot) every module is snapped to a
 * whole number of dots on the dot grid, so a 203 dpi thermal print doesn't
 * get uneven 5- and 6-dot modules that scanners trip over. The code then
 * comes out slightly smaller than its box, centred.
 */
export function renderCode(el: CodeElement, content: string, pixelMm?: number): string {
  const svg = toSVG({ bcid: el.symbology, text: content, paddingwidth: 0, paddingheight: 0 });
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!viewBox) throw new Error("Unexpected barcode output");
  const [vw, vh] = [Number(viewBox[1]), Number(viewBox[2])];
  const inner = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>")).trim();
  const twoD = SYMBOLOGIES[el.symbology].twoD;
  let sx = el.w / vw;
  let sy = el.h / vh;
  if (twoD) sx = sy = Math.min(sx, sy);
  if (pixelMm) {
    const [matrix] = raw(el.symbology, content, "");
    const modules = twoD ? (matrix.pixx ?? 0) : (matrix.sbs ?? []).reduce((a, b) => a + b, 0);
    if (modules > 0) {
      const unitsPerModule = vw / modules;
      const dots = Math.max(1, Math.floor((sx * unitsPerModule) / pixelMm));
      sx = (dots * pixelMm) / unitsPerModule;
      if (twoD) sy = sx;
    }
  }
  let x = el.x + (el.w - vw * sx) / 2;
  let y = el.y + (el.h - vh * sy) / 2;
  if (pixelMm) {
    x = Math.round(x / pixelMm) * pixelMm;
    y = Math.round(y / pixelMm) * pixelMm;
  }
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${+sx.toFixed(6)} ${+sy.toFixed(6)})">${inner}</g>`;
}

export type RenderOptions = { pixelMm?: number };

export type RenderedLabel = { body: string; errors: string[] };

/**
 * One label's elements in label coordinates (origin top-left, mm). Contents
 * a code can't encode (Code 39 has no lowercase, say) are left out and
 * reported in `errors` rather than failing the whole batch.
 */
export function renderLabelBody(
  template: LabelTemplate,
  vars: Partial<LabelVariables>,
  options: RenderOptions = {},
): RenderedLabel {
  const errors: string[] = [];
  const parts = template.elements.map((el) => {
    if (el.kind === "text") return renderText(el, vars);
    if (el.kind === "frame") {
      const inset = el.strokeWidth / 2;
      return (
        `<rect x="${n(el.x + inset)}" y="${n(el.y + inset)}" width="${n(Math.max(0, el.w - el.strokeWidth))}" ` +
        `height="${n(Math.max(0, el.h - el.strokeWidth))}" rx="${n(el.radius)}" fill="none" stroke="#000" ` +
        `stroke-width="${n(el.strokeWidth)}"/>`
      );
    }
    const content = fillVariables(el.text, vars);
    if (!content) return "";
    try {
      return renderCode(el, content, options.pixelMm);
    } catch (err) {
      const reason = err instanceof Error ? err.message.replace(/^bwipp\.\w+#\d+:\s*/, "") : "";
      errors.push(`${SYMBOLOGIES[el.symbology].name} can't encode "${content}"${reason ? `: ${reason}` : ""}`);
      return "";
    }
  });
  return { body: parts.filter(Boolean).join(""), errors };
}

function svgDocument(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(height)}mm" ` +
    `viewBox="0 0 ${n(width)} ${n(height)}">${body}</svg>`
  );
}

/** A single label as a standalone SVG at its own size. */
export function renderLabelSvg(template: LabelTemplate, vars: Partial<LabelVariables>): RenderedLabel {
  const { body, errors } = renderLabelBody(template, vars);
  return {
    body: svgDocument(template.width, template.height, `<rect width="100%" height="100%" fill="#fff"/>${body}`),
    errors,
  };
}

/**
 * Every label laid out onto pages: one SVG per page, at the page size of the
 * template's layout (the label size itself for label printers).
 */
export function renderPages(
  template: LabelTemplate,
  labels: Partial<LabelVariables>[],
  skip = 0,
  options: RenderOptions = {},
): { pages: string[]; errors: string[] } {
  const placements = placeLabels(template, labels.length, skip);
  const bodies: string[][] = [];
  const errors: string[] = [];
  labels.forEach((vars, i) => {
    const { page, x, y } = placements[i];
    const rendered = renderLabelBody(template, vars, options);
    errors.push(...rendered.errors.map((e) => (vars.code ? `${vars.code}: ${e}` : e)));
    (bodies[page] ??= []).push(
      x === 0 && y === 0 ? rendered.body : `<g transform="translate(${n(x)} ${n(y)})">${rendered.body}</g>`,
    );
  });
  const { width, height } = pageSize(template);
  const pages = Array.from({ length: bodies.length }, (_, i) =>
    svgDocument(width, height, (bodies[i] ?? []).join("")),
  );
  return { pages, errors };
}

/**
 * The variables as CSV, one row per location — for designing labels in an
 * external tool's mail merge (OpenLabelMaker, gLabels, P-touch Editor, Word)
 * instead of the built-in designer.
 */
export function labelsCsv(labels: LabelVariables[]): string {
  if (labels.length === 0) return "";
  const columns = Object.keys(labels[0]) as (keyof LabelVariables)[];
  return toCsv([columns, ...labels.map((row) => columns.map((c) => row[c]))]);
}
