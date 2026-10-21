// SVG geometry as polylines: path data, basic shapes and transforms, with
// curves flattened to straight segments within a tolerance. The building
// block for svg-outline.ts, which turns a label into plain filled paths for
// slicers. Pure string/number code, no DOM.

export type Pt = { x: number; y: number };
export type Polyline = { points: Pt[]; closed: boolean };
// SVG matrix(a b c d e f): x' = a·x + c·y + e, y' = b·x + d·y + f.
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied after `n` — a child's transform composed into its parent's. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const applyMatrix = (m: Matrix, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** How much a matrix scales lengths, on average — for flattening tolerances. */
export const matrixScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const numbers = (s: string) => (s.match(NUMBER) ?? []).map(Number);

/** The `transform` attribute; unknown functions are ignored. */
export function parseTransform(value: string | undefined): Matrix {
  let m = IDENTITY;
  if (!value) return m;
  for (const [, name, args] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = numbers(args);
    let t: Matrix | null = null;
    if (name === "matrix" && a.length === 6) t = a as Matrix;
    else if (name === "translate") t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (name === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (name === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (name === "skewX") t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY") t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (t) m = multiply(m, t);
  }
  return m;
}

// --- Curves ---

// Segment counts from the curve's second differences, so the chord error
// stays under `tol`.
const segments = (deviation: number, tol: number) =>
  Math.min(256, Math.max(1, Math.ceil(Math.sqrt(deviation / tol))));

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, out: Pt[]) {
  const dd = Math.max(
    Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
    Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
  );
  const n = segments(0.75 * dd, tol);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
}

function quad(p0: Pt, p1: Pt, p2: Pt, tol: number, out: Pt[]) {
  const n = segments(0.25 * Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y), tol);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y });
  }
}

/** An elliptical arc from the current point, per SVG's endpoint parameterisation. */
function arc(
  p0: Pt,
  rx: number,
  ry: number,
  angle: number,
  large: boolean,
  sweep: boolean,
  p1: Pt,
  tol: number,
  out: Pt[],
) {
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) {
    out.push(p1);
    return;
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  // Radii too small for the endpoints are scaled up (SVG F.6.6).
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const angleOf = (ux: number, uy: number) => Math.atan2(uy, ux);
  const t1 = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angleOf((-x1 - cx1) / rx, (-y1 - cy1) / ry) - t1;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  const r = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r))) || Math.PI / 8;
  const n = Math.min(256, Math.max(2, Math.ceil(Math.abs(dt) / step)));
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
}

// --- Path data ---

/**
 * Path data (`d`) as polylines, one per subpath. Arc flags may be written
 * without separators ("a1 1 0 00 1 1"), as minifiers do.
 */
export function flattenPath(d: string, tol: number): Polyline[] {
  // Commands as letters, numbers as their raw text (arc flags need it).
  const tokens: string[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  for (const m of d.matchAll(re)) tokens.push(m[1] ?? m[2]);
  const isCommand = (t: string | undefined) => t !== undefined && /^[a-z]$/i.test(t);
  const lines: Polyline[] = [];
  let points: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = cur;
  let lastCtrl: Pt | null = null;
  let lastCmd = "";
  let i = 0;
  const finish = (closed: boolean) => {
    if (points.length > 1) lines.push({ points, closed });
    points = [];
  };
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || isCommand(t)) throw new Error("bad path");
    return Number(t);
  };
  // Arc flags are one digit each, possibly glued to what follows ("011").
  const flag = () => {
    const t = tokens[i];
    if (t !== "0" && t !== "1" && !/^[01][\d.]/.test(t ?? "")) throw new Error("bad path");
    if (t.length > 1) tokens[i] = t.slice(1);
    else i++;
    return t[0] === "1";
  };
  let cmd = "";
  try {
    while (i < tokens.length) {
      if (isCommand(tokens[i])) cmd = tokens[i++];
      else if (!cmd) throw new Error("bad path");
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const at = (x: number, y: number): Pt => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
      if (C === "Z") {
        finish(true);
        cur = start;
        lastCtrl = null;
        lastCmd = "Z";
        // A following number continues with an implicit command; Z takes none.
        cmd = "";
        continue;
      }
      if (C === "M") {
        finish(false);
        cur = at(num(), num());
        start = cur;
        points = [cur];
        // Further pairs after M are implicit L.
        cmd = rel ? "l" : "L";
        lastCtrl = null;
        lastCmd = "M";
        continue;
      }
      if (points.length === 0) points = [cur];
      if (C === "L") cur = at(num(), num());
      else if (C === "H") cur = { x: rel ? cur.x + num() : num(), y: cur.y };
      else if (C === "V") cur = { x: cur.x, y: rel ? cur.y + num() : num() };
      if (C === "L" || C === "H" || C === "V") {
        points.push(cur);
        lastCtrl = null;
      } else if (C === "C" || C === "S") {
        const c1: Pt =
          C === "C"
            ? at(num(), num())
            : lastCtrl && (lastCmd === "C" || lastCmd === "S")
              ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y }
              : cur;
        const c2 = at(num(), num());
        const end = at(num(), num());
        cubic(cur, c1, c2, end, tol, points);
        lastCtrl = c2;
        cur = end;
      } else if (C === "Q" || C === "T") {
        const c: Pt =
          C === "Q"
            ? at(num(), num())
            : lastCtrl && (lastCmd === "Q" || lastCmd === "T")
              ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y }
              : cur;
        const end = at(num(), num());
        quad(cur, c, end, tol, points);
        lastCtrl = c;
        cur = end;
      } else if (C === "A") {
        const rx = num();
        const ry = num();
        const angle = num();
        const large = flag();
        const sweep = flag();
        const end = at(num(), num());
        arc(cur, rx, ry, angle, large, sweep, end, tol, points);
        lastCtrl = null;
        cur = end;
      } else throw new Error("bad path");
      lastCmd = C;
    }
  } catch {
    // Like browsers: draw what parsed before the error.
  }
  finish(false);
  return lines;
}

// --- Shapes ---

/** A rectangle, with corners rounded per SVG's rx/ry rules. */
export function rectPolyline(x: number, y: number, w: number, h: number, rx: number, ry: number, tol: number): Polyline {
  if (w <= 0 || h <= 0) return { points: [], closed: true };
  rx = Math.min(Math.max(0, rx), w / 2);
  ry = Math.min(Math.max(0, ry), h / 2);
  if (rx === 0 || ry === 0) {
    return { points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true };
  }
  const d =
    `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}` +
    `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
    `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
  return flattenPath(d, tol)[0];
}

export function ellipsePolyline(cx: number, cy: number, rx: number, ry: number, tol: number): Polyline {
  if (rx <= 0 || ry <= 0) return { points: [], closed: true };
  const r = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r))) || Math.PI / 8;
  const n = Math.min(512, Math.max(8, Math.ceil((2 * Math.PI) / step)));
  return {
    points: Array.from({ length: n }, (_, i) => ({
      x: cx + rx * Math.cos((2 * Math.PI * i) / n),
      y: cy + ry * Math.sin((2 * Math.PI * i) / n),
    })),
    closed: true,
  };
}

/** `points="…"` of a polyline or polygon. */
export function pointList(value: string | undefined): Pt[] {
  const n = numbers(value ?? "");
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
  return pts;
}
