// Pure helpers for printing labels on NIIMBOT thermal printers
// (label-printer's NIIMBOT panel, via niimbluelib). Thermal heads print
// dots, not greys: niimbluelib's encoder burns every pixel that isn't pure
// white, so the antialiased edge of a canvas render would print as a fat,
// smeared outline. The canvas is thresholded to pure black/white first.

export type PrintDirection = "left" | "top";

/** Pixel size of a label rendered at the printer's resolution. */
export function rasterSize(size: { width: number; height: number }, dpi: number) {
  const px = (mm: number) => Math.max(1, Math.round((mm / 25.4) * dpi));
  return { width: px(size.width), height: px(size.height) };
}

/**
 * Whether a label fits across the printhead. NIIMBOT models feed labels
 * either top-first ("top": the label's width spans the head, B1/B21) or
 * sideways ("left": the image is rotated, so its height spans the head —
 * the narrow D11/D110 rolls). Returns a reason when it doesn't fit.
 */
export function printheadProblem(
  sizePx: { width: number; height: number },
  printheadPixels: number,
  direction: PrintDirection,
): string | null {
  const across = direction === "left" ? sizePx.height : sizePx.width;
  if (across <= printheadPixels) return null;
  const side = direction === "left" ? "height" : "width";
  return `The label's ${side} is ${across} dots but the printhead is only ${printheadPixels} dots wide`;
}

// Luminance below this prints as a dot. 50% grey keeps text weight close to
// what the screen shows.
export const BLACK_THRESHOLD = 128;

/** Turns RGBA pixels into pure black/white in place; transparent counts as white. */
export function toMonochrome(rgba: Uint8ClampedArray, threshold = BLACK_THRESHOLD): Uint8ClampedArray {
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    // Composite over white, then Rec. 601 luma.
    const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]].map((c) => c * alpha + 255 * (1 - alpha));
    const value = 0.299 * r + 0.587 * g + 0.114 * b < threshold ? 0 : 255;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
    rgba[i + 3] = 255;
  }
  return rgba;
}
