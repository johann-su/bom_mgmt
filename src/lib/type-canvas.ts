// Placement of location types on the settings canvas, where the type grammar
// (which type may hold which, src/lib/code-grammar.ts) is drawn as a graph
// flowing left to right: Shelf → Box → Bin. Types the user has dragged keep
// their saved spot; the rest are laid out in columns by nesting depth.

export const COLUMN_WIDTH = 340;
export const ROW_HEIGHT = 120;

export type CanvasType = {
  id: string;
  // Child types it may hold; null = any.
  childTypeIds: string[] | null;
  canvasX: number | null;
  canvasY: number | null;
};

export type Point = { x: number; y: number };

/**
 * Columns by depth: types no restricted type holds start at 0 (as do types
 * that hold "any", which have no drawn links), each child one column right of
 * its shallowest parent. Cycles (Box in Box) don't push a type further right.
 */
export function depths(types: CanvasType[]): Map<string, number> {
  const ids = new Set(types.map((t) => t.id));
  const held = new Set<string>();
  for (const t of types) {
    for (const child of t.childTypeIds ?? []) if (child !== t.id) held.add(child);
  }
  const depth = new Map<string, number>();
  const queue = types.filter((t) => !held.has(t.id)).map((t) => t.id);
  for (const id of queue) depth.set(id, 0);
  const byId = new Map(types.map((t) => [t.id, t]));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const child of byId.get(id)?.childTypeIds ?? []) {
      if (!ids.has(child) || depth.has(child)) continue;
      depth.set(child, depth.get(id)! + 1);
      queue.push(child);
    }
  }
  // Only reachable through a cycle (A holds B, B holds A, nothing else).
  for (const t of types) if (!depth.has(t.id)) depth.set(t.id, 0);
  return depth;
}

/** Every type in a fresh left-to-right layout, ignoring saved positions. */
export function autoLayout(types: CanvasType[]): Map<string, Point> {
  const depth = depths(types);
  const rows = new Map<number, number>();
  const out = new Map<string, Point>();
  for (const t of types) {
    const column = depth.get(t.id)!;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    out.set(t.id, { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT });
  }
  return out;
}

/**
 * Where each type is drawn: its saved spot, or — for types not placed yet,
 * like one just created — the auto layout, shifted below everything placed
 * so it can't land on top of a node.
 */
export function placeTypes(types: CanvasType[]): Map<string, Point> {
  const auto = autoLayout(types);
  const placed = types.filter((t) => t.canvasX !== null && t.canvasY !== null);
  const below = placed.length ? Math.max(...placed.map((t) => t.canvasY!)) + ROW_HEIGHT * 1.5 : 0;
  const unplaced = types.filter((t) => !placed.includes(t));
  const top = Math.min(...unplaced.map((t) => auto.get(t.id)!.y));
  const out = new Map<string, Point>();
  for (const t of types) {
    out.set(
      t.id,
      placed.includes(t)
        ? { x: t.canvasX!, y: t.canvasY! }
        : { x: auto.get(t.id)!.x, y: auto.get(t.id)!.y - top + below },
    );
  }
  return out;
}

/**
 * The child list after linking `parent` → `child` on the canvas. A type that
 * held "any" becomes restricted to just the new link — drawing a link says
 * what belongs inside, so the implicit "everything" goes.
 */
export function withLink(childTypeIds: string[] | null, child: string): string[] {
  if (childTypeIds === null) return [child];
  return childTypeIds.includes(child) ? childTypeIds : [...childTypeIds, child];
}

/** The child list after removing `parent` → `child`; a type left with none holds parts only. */
export function withoutLink(childTypeIds: string[] | null, child: string): string[] | null {
  return childTypeIds === null ? null : childTypeIds.filter((id) => id !== child);
}

// --- link routing ---------------------------------------------------------
//
// Links leave a type's right handle and enter the next type's left handle.
// A plain curve works while the target sits to the right with nothing in
// between; a link pointing back left (test2 → test1) or across another type
// would run behind the cards, so it's routed around them instead: out to the
// right, along a lane just above or below every card in the way, and in from
// the left.

export type Rect = { x: number; y: number; width: number; height: number };

// How far a routed link stands off the cards and handles.
export const ROUTE_GAP = 24;
const CORNER = 10;

function bezierPoint(s: Point, c1: Point, c2: Point, t: Point, u: number): Point {
  const v = 1 - u;
  return {
    x: v * v * v * s.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * t.x,
    y: v * v * v * s.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * t.y,
  };
}

function inside(p: Point, r: Rect, pad: number): boolean {
  return p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;
}

// Straight lines through `points` with rounded corners.
function roundedPath(points: Point[]): string {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, at, next] = [points[i - 1], points[i], points[i + 1]];
    const r = Math.min(CORNER, Math.hypot(at.x - prev.x, at.y - prev.y) / 2, Math.hypot(next.x - at.x, next.y - at.y) / 2);
    const toward = (p: Point) => {
      const len = Math.hypot(p.x - at.x, p.y - at.y) || 1;
      return { x: at.x + ((p.x - at.x) / len) * r, y: at.y + ((p.y - at.y) / len) * r };
    };
    const a = toward(prev);
    const b = toward(next);
    d += ` L ${a.x} ${a.y} Q ${at.x} ${at.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/**
 * The SVG path of a link from `source` (a right handle) to `target` (a left
 * handle), and where its remove button goes. `cards` are every type's box,
 * the link's own two included.
 */
export function routeLink(
  source: Point,
  target: Point,
  cards: Rect[],
): { path: string; label: Point; routed: boolean } {
  const bend = Math.max(Math.abs(target.x - source.x) / 2, ROUTE_GAP * 2);
  const c1 = { x: source.x + bend, y: source.y };
  const c2 = { x: target.x - bend, y: target.y };
  const forward = target.x > source.x + ROUTE_GAP;
  // The curve may touch its own cards only at the handles, so sample its
  // inner part against every card.
  let clear = forward;
  for (let i = 1; clear && i < 32; i++) {
    const p = bezierPoint(source, c1, c2, target, i / 32);
    if (cards.some((r) => inside(p, r, 4))) clear = false;
  }
  if (clear) {
    return {
      path: `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`,
      label: bezierPoint(source, c1, c2, target, 0.5),
      routed: false,
    };
  }

  const right = source.x + ROUTE_GAP;
  const left = target.x - ROUTE_GAP;
  // Cards the lane has to clear: anything overlapping the span it crosses.
  const lo = Math.min(left, right);
  const hi = Math.max(left, right);
  const inWay = cards.filter((r) => r.x < hi && r.x + r.width > lo);
  const top = Math.min(source.y, target.y, ...inWay.map((r) => r.y)) - ROUTE_GAP;
  const bottom = Math.max(source.y, target.y, ...inWay.map((r) => r.y + r.height)) + ROUTE_GAP;
  const cost = (lane: number) => Math.abs(source.y - lane) + Math.abs(target.y - lane);
  // Ties (cards in one row) go below: self-loops arc above the card.
  const lane = cost(top) < cost(bottom) ? top : bottom;
  const points = [
    source,
    { x: right, y: source.y },
    { x: right, y: lane },
    { x: left, y: lane },
    { x: left, y: target.y },
    target,
  ];
  return { path: roundedPath(points), label: { x: (left + right) / 2, y: lane }, routed: true };
}
