// Snapping and alignment for the label designer's canvas. Pure geometry in
// mm, so the drag handlers in label-canvas.tsx stay thin and this is testable.
//
// While dragging, an element's edges and centre snap to "targets" — the
// label's edges and centre line and every other element's edges and centre —
// when they come within `threshold`, and the canvas draws a guide line there.
// Otherwise the position snaps to the grid (unless the grid is off). Rotated
// elements snap by their axis-aligned bounding box, which is what lines up
// visually.

// `rotation` is in degrees clockwise about the box's centre, as in templates.
export type Rect = { x: number; y: number; w: number; h: number; rotation?: number };
export type Guide = { axis: "x" | "y"; at: number };
export type SnapOptions = {
  // Grid pitch in mm; 0 disables grid snapping.
  grid: number;
  // How close (mm) an edge must be to a target to snap to it.
  threshold: number;
  // Snap to the label and the other elements, not only the grid.
  objects: boolean;
};

const round = (v: number) => +v.toFixed(2);
const EPS = 1e-6;

/** The axis-aligned box a (possibly rotated) element covers. */
export function boundingBox(r: Rect): Rect {
  const angle = ((r.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const w = r.w * cos + r.h * sin;
  const h = r.w * sin + r.h * cos;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** Edges and centre lines the dragged element can snap to, per axis. */
export function snapTargets(label: { width: number; height: number }, others: Rect[]) {
  const x = [0, label.width / 2, label.width];
  const y = [0, label.height / 2, label.height];
  for (const r of others.map(boundingBox)) {
    x.push(r.x, r.x + r.w / 2, r.x + r.w);
    y.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { x, y };
}

/**
 * Finds the smallest shift that puts one of `points` on one of `targets`,
 * if any is within `threshold`.
 */
function nearest(points: number[], targets: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const p of points) {
    for (const t of targets) {
      const d = t - p;
      if (Math.abs(d) <= threshold + EPS && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

function guidesAt(axis: Guide["axis"], points: number[], targets: number[]): Guide[] {
  const hits = new Set<number>();
  for (const t of targets) if (points.some((p) => Math.abs(p - t) < 1e-3)) hits.add(round(t));
  return [...hits].map((at) => ({ axis, at }));
}

const toGrid = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid : v);

/** Snaps an element being moved to `box` (its unsnapped position). */
export function snapMove(
  box: Rect,
  targets: { x: number[]; y: number[] },
  opts: SnapOptions,
): { box: Rect; guides: Guide[] } {
  // Snap the bounding box, then move the element by the same amount.
  const bb = boundingBox(box);
  const axis = (pos: number, size: number, ts: number[]) => {
    const shift = opts.objects ? nearest([pos, pos + size / 2, pos + size], ts, opts.threshold) : null;
    return shift === null ? toGrid(pos, opts.grid) : pos + shift;
  };
  const bx = axis(bb.x, bb.w, targets.x);
  const by = axis(bb.y, bb.h, targets.y);
  const guides = opts.objects
    ? [
        ...guidesAt("x", [bx, bx + bb.w / 2, bx + bb.w], targets.x),
        ...guidesAt("y", [by, by + bb.h / 2, by + bb.h], targets.y),
      ]
    : [];
  return { box: { ...box, x: round(box.x + bx - bb.x), y: round(box.y + by - bb.y) }, guides };
}

/**
 * Snaps an unrotated element being resized from its bottom-right corner.
 * With `ratio` (w / h) the proportions are kept: the axis the pointer has
 * pulled further decides the size, and only that edge snaps.
 */
export function snapResize(
  box: Rect,
  targets: { x: number[]; y: number[] },
  opts: SnapOptions & { minSize: number; ratio?: number },
): { box: Rect; guides: Guide[] } {
  // Only the far edge moves, so only it snaps; the grid applies to the edge
  // too, so an element at an off-grid position still ends on a grid line.
  const axis = (pos: number, size: number, ts: number[]) => {
    const end = pos + size;
    const shift = opts.objects ? nearest([end], ts, opts.threshold) : null;
    const snapped = shift === null ? toGrid(end, opts.grid) : end + shift;
    return Math.max(opts.minSize, snapped - pos);
  };
  let { w, h } = box;
  const { ratio } = opts;
  if (!ratio) {
    w = axis(box.x, w, targets.x);
    h = axis(box.y, h, targets.y);
  } else if (w / ratio >= h) {
    w = axis(box.x, w, targets.x);
    h = w / ratio;
  } else {
    h = axis(box.y, h, targets.y);
    w = h * ratio;
  }
  ({ w, h } = atLeast(w, h, opts.minSize, !!ratio));
  w = round(w);
  h = round(h);
  const guides = opts.objects
    ? [...guidesAt("x", [box.x + w], targets.x), ...guidesAt("y", [box.y + h], targets.y)]
    : [];
  return { box: { ...box, w, h }, guides };
}

// Grows a size to `min` on both axes — uniformly when keeping proportions.
function atLeast(w: number, h: number, min: number, uniform: boolean) {
  if (!uniform) return { w: Math.max(min, w), h: Math.max(min, h) };
  const k = Math.max(1, min / w, min / h);
  return { w: w * k, h: h * k };
}

/**
 * Resizes a rotated element whose corner handle the pointer moved by
 * (dx, dy) on the label. The drag is measured along the element's own axes
 * and its opposite (top-left) corner stays put on the label. No grid or
 * object snapping — neither lines up with a tilted edge.
 */
export function resizeRotated(
  start: Rect,
  dx: number,
  dy: number,
  opts: { minSize: number; keepRatio: boolean },
): Rect {
  const angle = ((start.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let w = start.w + dx * cos + dy * sin;
  let h = start.h - dx * sin + dy * cos;
  if (opts.keepRatio) {
    const ratio = start.w / start.h;
    if (w / ratio >= h) h = w / ratio;
    else w = h * ratio;
  }
  ({ w, h } = atLeast(w, h, opts.minSize, opts.keepRatio));
  // The fixed corner relative to the centre is R·(-w/2, -h/2); keep it where
  // it was and put the new centre at corner + R·(w/2, h/2).
  const rot = (px: number, py: number) => [px * cos - py * sin, px * sin + py * cos];
  const [ox, oy] = rot(-start.w / 2, -start.h / 2);
  const cornerX = start.x + start.w / 2 + ox;
  const cornerY = start.y + start.h / 2 + oy;
  const [hx, hy] = rot(w / 2, h / 2);
  return {
    ...start,
    x: round(cornerX + hx - w / 2),
    y: round(cornerY + hy - h / 2),
    w: round(w),
    h: round(h),
  };
}

// Angles a free rotation sticks to when this close, so straight is easy to hit.
const RIGHT_ANGLE_PULL = 4;

/**
 * Normalises a rotation to [0, 360). With `step` (Shift held) it locks to
 * multiples of it; otherwise it sticks to 0/90/180/270 when close, unless
 * `free` (Alt held).
 */
export function snapRotation(deg: number, opts: { step?: number; free?: boolean } = {}): number {
  let r = deg;
  if (opts.step) r = Math.round(r / opts.step) * opts.step;
  else if (!opts.free) {
    const right = Math.round(r / 90) * 90;
    if (Math.abs(r - right) <= RIGHT_ANGLE_PULL) r = right;
  }
  r = +(((r % 360) + 360) % 360).toFixed(1);
  return r === 360 ? 0 : r;
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** The axis-aligned box covering all of `rects` (rotation included). */
export function unionBox(rects: Rect[]): Rect {
  const boxes = rects.map(boundingBox);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Position of `box` with its visible (bounding) box aligned inside `area`. */
function alignWithin(box: Rect, area: Rect, how: Alignment): { x: number; y: number } {
  const bb = boundingBox(box);
  const move = (dx: number, dy: number) => ({ x: round(box.x + dx), y: round(box.y + dy) });
  switch (how) {
    case "left":
      return move(area.x - bb.x, 0);
    case "center":
      return move(area.x + (area.w - bb.w) / 2 - bb.x, 0);
    case "right":
      return move(area.x + area.w - bb.w - bb.x, 0);
    case "top":
      return move(0, area.y - bb.y);
    case "middle":
      return move(0, area.y + (area.h - bb.h) / 2 - bb.y);
    case "bottom":
      return move(0, area.y + area.h - bb.h - bb.y);
  }
}

/** Position of `box` aligned to an edge or centre line of the label. */
export function alignToLabel(
  box: Rect,
  label: { width: number; height: number },
  how: Alignment,
): { x: number; y: number } {
  return alignWithin(box, { x: 0, y: 0, w: label.width, h: label.height }, how);
}

type WithId = Rect & { id: string };

/**
 * New positions for aligning several elements: one element aligns to the
 * label, several align to each other — to the edge or centre line of the box
 * they cover together, as in every drawing app.
 */
export function alignElements(
  boxes: WithId[],
  label: { width: number; height: number },
  how: Alignment,
): Record<string, { x: number; y: number }> {
  const area = boxes.length === 1 ? { x: 0, y: 0, w: label.width, h: label.height } : unionBox(boxes);
  return Object.fromEntries(boxes.map((b) => [b.id, alignWithin(b, area, how)]));
}

/**
 * Spreads three or more elements so the gaps between them are equal along
 * `axis`; the outermost two stay where they are.
 */
export function distributeElements(boxes: WithId[], axis: "x" | "y"): Record<string, { x: number; y: number }> {
  if (boxes.length < 3) return {};
  const [pos, size] = axis === "x" ? (["x", "w"] as const) : (["y", "h"] as const);
  const sorted = boxes
    .map((b) => ({ b, bb: boundingBox(b) }))
    .sort((p, q) => p.bb[pos] + p.bb[size] / 2 - (q.bb[pos] + q.bb[size] / 2));
  const first = sorted[0].bb;
  const last = sorted[sorted.length - 1].bb;
  const used = sorted.reduce((sum, { bb }) => sum + bb[size], 0);
  const gap = (last[pos] + last[size] - first[pos] - used) / (sorted.length - 1);
  const result: Record<string, { x: number; y: number }> = {};
  let at = first[pos];
  for (const { b, bb } of sorted) {
    const shift = at - bb[pos];
    result[b.id] = { x: round(b.x + (axis === "x" ? shift : 0)), y: round(b.y + (axis === "y" ? shift : 0)) };
    at += bb[size] + gap;
  }
  return result;
}

/** Whether the element's visible box touches `area` — for drag-to-select. */
export function touches(box: Rect, area: Rect): boolean {
  const bb = boundingBox(box);
  return bb.x <= area.x + area.w && bb.x + bb.w >= area.x && bb.y <= area.y + area.h && bb.y + bb.h >= area.y;
}
