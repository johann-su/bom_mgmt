// Browser-only: turns the page SVGs from label-render.ts into downloadable
// files. jsPDF/svg2pdf need a real DOM and are large, so they're imported on
// demand when the user actually exports.

import { strToU8, zipSync } from "fflate";
import { rasterSize } from "@/lib/niimbot-raster";

export type PageSize = { width: number; height: number }; // mm

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function parseSvg(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
}

/**
 * One vector PDF page per SVG page, at the exact page size in mm — what label
 * printer drivers and "actual size" sheet printing expect. Text uses the
 * standard PDF fonts (Helvetica/Courier), so nothing is embedded.
 */
export async function pagesToPdf(pages: string[], size: PageSize): Promise<Blob> {
  const [{ jsPDF }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const orientation = size.width > size.height ? "landscape" : "portrait";
  const format = [size.width, size.height];
  const pdf = new jsPDF({ unit: "mm", format, orientation, compress: true });
  // svg2pdf reads computed styles, so the SVG has to be in the document.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
  document.body.append(host);
  try {
    for (const [i, page] of pages.entries()) {
      if (i > 0) pdf.addPage(format, orientation);
      const el = parseSvg(page);
      host.replaceChildren(el);
      await pdf.svg(el, { x: 0, y: 0, width: size.width, height: size.height });
    }
  } finally {
    host.remove();
  }
  return pdf.output("blob");
}

/**
 * Draws one SVG page onto a white canvas at `dpi`. The SVG is sized in pixels
 * first so the browser rasterises it at full resolution instead of scaling
 * up a 96 dpi bitmap.
 */
export async function svgToCanvas(svg: string, size: PageSize, dpi: number): Promise<HTMLCanvasElement> {
  const { width: w, height: h } = rasterSize(size, dpi);
  const sized = svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterises one SVG page at `dpi` (300 suits most thermal label printers). */
export async function svgToPng(svg: string, size: PageSize, dpi = 300): Promise<Blob> {
  const canvas = await svgToCanvas(svg, size, dpi);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
  );
}

/**
 * Pages converted to plain filled outlines for slicers (svg-outline.ts).
 * The converter, polygon library and fonts load only when this is used.
 */
export async function svgsToOutlines(pages: string[]): Promise<{ pages: string[]; warnings: string[] }> {
  const [{ outlineSvg }, { loadLabelFonts, textOutliner }] = await Promise.all([
    import("@/lib/svg-outline"),
    import("@/lib/label-fonts"),
  ]);
  const outliner = textOutliner(await loadLabelFonts());
  const warnings = new Set<string>();
  const out = pages.map((page) => {
    const result = outlineSvg(page, outliner);
    result.warnings.forEach((w) => warnings.add(w));
    return result.svg;
  });
  return { pages: out, warnings: [...warnings] };
}

/**
 * A single file as-is, several as a ZIP (`name-01.ext`, `name-02.ext`, …)
 * named after the format, so the SVG and PNG archives don't overwrite each other.
 */
export async function filesOrZip(
  files: (string | Blob)[],
  basename: string,
  ext: string,
  type: string,
): Promise<{ blob: Blob; filename: string }> {
  if (files.length === 1) {
    const [file] = files;
    return { blob: file instanceof Blob ? file : new Blob([file], { type }), filename: `${basename}.${ext}` };
  }
  const width = String(files.length).length;
  const entries: Record<string, Uint8Array> = {};
  for (const [i, file] of files.entries()) {
    const name = `${basename}-${String(i + 1).padStart(width, "0")}.${ext}`;
    entries[name] = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : strToU8(file);
  }
  return {
    blob: new Blob([zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    filename: `${basename}-${ext}.zip`,
  };
}
