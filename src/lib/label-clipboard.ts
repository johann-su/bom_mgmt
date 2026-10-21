// Copy/paste of label elements via the system clipboard, so elements can move
// between templates (and browser tabs). The clipboard holds tagged JSON; on
// paste it is untrusted input and goes through the same validation as a
// saved template.

import { parseTemplate, type LabelElement } from "@/lib/label-template";

const MARKER = "bom-mgmt/label-elements";
// Pasting onto the originals (or a previous paste) shifts by this much, so
// the copy is visible rather than hidden exactly on top.
const OFFSET = 1;

export function serializeElements(elements: LabelElement[]): string {
  return JSON.stringify({ type: MARKER, elements });
}

/** The elements on the clipboard, or null if it holds anything else. */
export function parseClipboard(text: string): LabelElement[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== MARKER) return null;
  // A stand-in label just large enough for anything parseTemplate allows.
  const parsed = parseTemplate({ width: 1000, height: 1000, elements: (data as { elements?: unknown }).elements });
  return "error" in parsed || parsed.elements.length === 0 ? null : parsed.elements;
}

/**
 * The pasted elements with fresh ids, shifted down-right while they'd land
 * exactly on an element that's already there — so pasting repeatedly makes
 * a staircase instead of a hidden stack.
 */
export function placePasted(
  existing: LabelElement[],
  pasted: LabelElement[],
  makeId: () => string,
): LabelElement[] {
  const taken = new Set(existing.map((e) => `${e.x},${e.y}`));
  const collides = (shift: number) =>
    pasted.some((e) => taken.has(`${+(e.x + shift).toFixed(2)},${+(e.y + shift).toFixed(2)}`));
  let shift = 0;
  while (collides(shift) && shift < 100) shift += OFFSET;
  return pasted.map((e) => ({ ...e, id: makeId(), x: +(e.x + shift).toFixed(2), y: +(e.y + shift).toFixed(2) }));
}
