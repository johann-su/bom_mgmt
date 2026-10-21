// Stacking order of label elements. A template's `elements` array is the
// drawing order: later elements are drawn on top of earlier ones. These
// helpers reorder it for the designer's layer list and its "bring forward /
// send backward" commands. Pure, so a multi-selection's edge cases are
// testable.

type WithId = { id: string };

export type Restack = "front" | "forward" | "backward" | "back";

/**
 * Moves the elements in `ids` (keeping their order among themselves) to just
 * before or after `anchorId` in drawing order — "after" is in front of it.
 * Dropping onto one of the moved elements changes nothing.
 */
export function moveElements<T extends WithId>(
  elements: T[],
  ids: string[],
  anchorId: string,
  side: "before" | "after",
): T[] {
  const moving = new Set(ids);
  if (moving.has(anchorId) || !elements.some((e) => e.id === anchorId)) return elements;
  const moved = elements.filter((e) => moving.has(e.id));
  const rest = elements.filter((e) => !moving.has(e.id));
  const at = rest.findIndex((e) => e.id === anchorId) + (side === "after" ? 1 : 0);
  const result = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  return result.every((e, i) => e === elements[i]) ? elements : result;
}

/**
 * Brings the selection forward or sends it back, one step (past the next
 * unselected element) or all the way. Selected elements keep their order
 * among themselves, and a selection already at the edge stays put.
 */
export function restack<T extends WithId>(elements: T[], ids: string[], how: Restack): T[] {
  const selected = new Set(ids);
  const isSel = (e: T) => selected.has(e.id);
  if (how === "front") return keepIfSame(elements, [...elements.filter((e) => !isSel(e)), ...elements.filter(isSel)]);
  if (how === "back") return keepIfSame(elements, [...elements.filter(isSel), ...elements.filter((e) => !isSel(e))]);
  const result = [...elements];
  if (how === "forward") {
    // From the top down, so a block of selected elements moves as one.
    for (let i = result.length - 2; i >= 0; i--) {
      if (isSel(result[i]) && !isSel(result[i + 1])) [result[i], result[i + 1]] = [result[i + 1], result[i]];
    }
  } else {
    for (let i = 1; i < result.length; i++) {
      if (isSel(result[i]) && !isSel(result[i - 1])) [result[i], result[i - 1]] = [result[i - 1], result[i]];
    }
  }
  return keepIfSame(elements, result);
}

// The same array when nothing moved, so the designer records no undo step.
function keepIfSame<T>(before: T[], after: T[]): T[] {
  return after.every((e, i) => e === before[i]) ? before : after;
}
