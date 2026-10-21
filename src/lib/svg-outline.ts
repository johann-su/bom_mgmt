// Turns a rendered label (SVG) into plain filled outlines, for importing into
// slicers (Bambu Studio, OrcaSlicer, PrusaSlicer) to 3D print or emboss it.
// Those importers only read filled path shapes: <text> is dropped, strokes
// become hairlines or vanish, and masks, clip paths and white-on-black are
// ignored — a hex nut with a masked hole prints as a solid hexagon.
//
// So everything is resolved to geometry here and painted in drawing order
// onto a single-colour "ink" layer: dark paint adds ink, light paint (white
// text on a black bar, a mask's cut-out) removes it, using the same
// black-or-white threshold as the thermal printers. Text becomes glyph
// outlines (via an injected TextOutliner), strokes become filled outlines,
// and masks and clip paths become real intersections. The result is one
// compound path with real holes.

import { ClipType, Clipper, EndType, FillRule, JoinType, type PathsD } from "clipper2-ts";
import {
  IDENTITY,
  applyMatrix,
  ellipsePolyline,
  flattenPath,
  matrixScale,
  multiply,
  parseTransform,
  pointList,
  rectPolyline,
  type Matrix,
  type Polyline,
} from "@/lib/svg-geometry";
import { parseXml, type XmlElement, type XmlNode } from "@/lib/svg-sanitize";

export type TextRun = {
  text: string;
  x: number;
  y: number;
  // In the text's user units (mm on a label).
  size: number;
  mono: boolean;
  bold: boolean;
  anchor: "start" | "middle" | "end";
};
/** Glyph outlines of a run (y down, baseline at run.y) and its advance width. */
export type TextOutliner = (run: TextRun, tolerance: number) => { outlines: Polyline[]; advance: number };

// Decimal places Clipper works at: 0.1 µm on a label, plenty for a nozzle.
const PRECISION = 4;
// Chord error allowed when flattening curves, in label units (mm).
const TOLERANCE = 0.005;
const MAX_DEPTH = 40;

// Properties that children inherit; the rest apply to one element only.
const INHERITED = new Set([
  "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "color", "visibility", "font-family", "font-size", "font-weight", "text-anchor", "clip-rule",
]);
// Never painted where they stand; only referenced (or ignored).
const NOT_RENDERED = new Set([
  "defs", "clipPath", "mask", "linearGradient", "radialGradient", "symbol", "title", "desc",
  "metadata", "style", "pattern", "filter", "marker", "script", "foreignObject", "image",
]);

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9",
  navy: "#000080", maroon: "#800000", purple: "#800080", teal: "#008080", lime: "#00ff00",
  aqua: "#00ffff", cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff", olive: "#808000",
};

type Style = Record<string, string>;
type Ctx = { ctm: Matrix; style: Style; alpha: number; depth: number };
// One painting step: an area that adds ink (dark) or removes it (light).
type Op = { dark: boolean; region: PathsD };
type Color = { lum: number; alpha: number };

class Outliner {
  ids = new Map<string, XmlElement>();
  warnings = new Set<string>();
  viewport = { w: 100, h: 100 };

  constructor(private text: TextOutliner | null) {}

  index(nodes: XmlNode[]) {
    for (const n of nodes) {
      if ("text" in n) continue;
      const id = attr(n, "id");
      if (id) this.ids.set(id, n);
      this.index(n.children);
    }
  }

  ref(value: string | undefined): XmlElement | null {
    const m = value && /^\s*url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value);
    const href = !m && value?.trim().startsWith("#") ? value.trim().slice(1) : null;
    return this.ids.get(m ? m[1] : (href ?? "")) ?? null;
  }

  // --- Walking ---

  collect(nodes: XmlNode[], ctx: Ctx, out: Op[]) {
    for (const n of nodes) if (!("text" in n)) this.render(n, ctx, out);
  }

  render(el: XmlElement, parent: Ctx, out: Op[], ownTransform = true) {
    if (parent.depth > MAX_DEPTH || NOT_RENDERED.has(el.tag)) return;
    const own = styleOf(el);
    if (own.display === "none") return;
    const style: Style = { ...parent.style };
    for (const [k, v] of Object.entries(own)) if (INHERITED.has(k) && v !== "inherit") style[k] = v;
    const ctm = ownTransform ? multiply(parent.ctm, parseTransform(attr(el, "transform"))) : parent.ctm;
    const ctx: Ctx = { ctm, style, alpha: parent.alpha * opacity(own.opacity), depth: parent.depth + 1 };
    const ops: Op[] = [];

    if (el.tag === "use") {
      const target = this.ref(attr(el, "href") ?? attr(el, "xlink:href"));
      const moved = { ...ctx, ctm: multiply(ctm, [1, 0, 0, 1, this.len(el, "x", "w"), this.len(el, "y", "h")]) };
      if (target?.tag === "symbol") this.collect(target.children, moved, ops);
      else if (target) this.render(target, moved, ops);
    } else if (el.tag === "text") {
      this.renderText(el, ctx, ops);
    } else if (SHAPES.has(el.tag)) {
      this.paint(this.shape(el, TOLERANCE / matrixScale(ctm)), ctx, ops, el.tag !== "line" && el.tag !== "polyline");
    } else {
      // g, a, switch, nested svg: just their children.
      this.collect(el.children, ctx, ops);
    }

    if (ops.length === 0) return;
    // Clip paths and masks live in the element's own user space.
    const clip = own["clip-path"] && own["clip-path"] !== "none" ? this.clipRegion(own["clip-path"], ctx) : null;
    const mask = own.mask && own.mask !== "none" ? this.maskRegion(own.mask, ctx) : null;
    for (const op of ops) {
      let region = op.region;
      if (clip) region = Clipper.intersectD(region, clip, FillRule.NonZero, PRECISION);
      if (mask) region = Clipper.intersectD(region, mask, FillRule.NonZero, PRECISION);
      if (region.length) out.push({ dark: op.dark, region });
    }
  }

  // --- Shapes and paint ---

  len(el: XmlElement, name: string, axis: "w" | "h", fallback = 0): number {
    const v = attr(el, name);
    if (v === undefined) return fallback;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return fallback;
    return v.trim().endsWith("%") ? (n / 100) * this.viewport[axis] : n;
  }

  shape(el: XmlElement, tol: number): Polyline[] {
    const L = (name: string, axis: "w" | "h", fallback = 0) => this.len(el, name, axis, fallback);
    switch (el.tag) {
      case "rect": {
        const rxAttr = attr(el, "rx");
        const ryAttr = attr(el, "ry");
        const rx = L("rx", "w", ryAttr !== undefined ? L("ry", "h") : 0);
        const ry = L("ry", "h", rxAttr !== undefined ? rx : 0);
        return [rectPolyline(L("x", "w"), L("y", "h"), L("width", "w"), L("height", "h"), rx, ry, tol)];
      }
      case "circle": {
        const r = L("r", "w");
        return [ellipsePolyline(L("cx", "w"), L("cy", "h"), r, r, tol)];
      }
      case "ellipse":
        return [ellipsePolyline(L("cx", "w"), L("cy", "h"), L("rx", "w"), L("ry", "h"), tol)];
      case "line":
        return [{ points: [{ x: L("x1", "w"), y: L("y1", "h") }, { x: L("x2", "w"), y: L("y2", "h") }], closed: false }];
      case "polyline":
        return [{ points: pointList(attr(el, "points")), closed: false }];
      case "polygon":
        return [{ points: pointList(attr(el, "points")), closed: true }];
      case "path":
        return flattenPath(attr(el, "d") ?? "", tol);
    }
    return [];
  }

  /** Fill then stroke (SVG's default paint order) as ink operations. */
  paint(lines: Polyline[], ctx: Ctx, ops: Op[], hasArea = true, fillRule?: FillRule) {
    const { style, ctm } = ctx;
    if (style.visibility === "hidden" || style.visibility === "collapse") return;
    lines = lines.filter((l) => l.points.length > 0);
    if (lines.length === 0) return;

    const fill = this.paintValue(style.fill ?? "black", style);
    const fillDark = classify(fill, ctx.alpha * opacity(style["fill-opacity"]));
    if (fillDark !== null && hasArea) {
      const rule = fillRule ?? (style["fill-rule"] === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero);
      const region = unite(transform(lines.filter((l) => l.points.length > 2), ctm), rule);
      if (region.length) ops.push({ dark: fillDark, region });
    }

    const stroke = this.paintValue(style.stroke ?? "none", style);
    const width = parseFloat(style["stroke-width"] ?? "1");
    const strokeDark = classify(stroke, ctx.alpha * opacity(style["stroke-opacity"]));
    if (strokeDark === null || !(width > 0)) return;
    if (style["stroke-dasharray"] && style["stroke-dasharray"] !== "none") {
      this.warnings.add("Dashed lines were exported as solid lines");
    }
    // Offset in the element's own units, so non-uniform scaling (a stretched
    // graphic) widens the stroke the way the renderer does.
    const join = ({ round: JoinType.Round, bevel: JoinType.Bevel } as Record<string, JoinType>)[
      style["stroke-linejoin"] ?? ""
    ] ?? JoinType.Miter;
    const cap = ({ round: EndType.Round, square: EndType.Square } as Record<string, EndType>)[
      style["stroke-linecap"] ?? ""
    ] ?? EndType.Butt;
    const miter = parseFloat(style["stroke-miterlimit"] ?? "4") || 4;
    const arcTol = TOLERANCE / matrixScale(ctm);
    const toD = (ls: Polyline[]) => ls.map((l) => l.points.map((p) => ({ x: p.x, y: p.y })));
    const closed = lines.filter((l) => l.closed && l.points.length > 2);
    const open = lines.filter((l) => !l.closed || l.points.length <= 2);
    const outline = [
      ...(closed.length ? Clipper.inflatePathsD(toD(closed), width / 2, join, EndType.Joined, miter, 6, arcTol) : []),
      ...(open.length ? Clipper.inflatePathsD(toD(open), width / 2, join, cap, miter, 6, arcTol) : []),
    ];
    const region = unite(transform(outline.map((points) => ({ points, closed: true })), ctm), FillRule.NonZero);
    if (region.length) ops.push({ dark: strokeDark, region });
  }

  paintValue(value: string, style: Style): Color | null {
    const v = value.trim();
    if (v === "none" || v === "transparent") return null;
    if (v === "currentColor") return parseColor(style.color ?? "black");
    if (v.startsWith("url(")) {
      const target = this.ref(v);
      if (target && (target.tag === "linearGradient" || target.tag === "radialGradient")) return this.gradient(target);
      // A missing or unsupported paint server falls back to what follows it.
      const fallback = v.replace(/^url\([^)]*\)\s*/, "");
      return fallback ? this.paintValue(fallback, style) : null;
    }
    return parseColor(v);
  }

  /** A gradient counts as the average of its stops. */
  gradient(el: XmlElement, depth = 0): Color | null {
    const stops = el.children.filter((c): c is XmlElement => !("text" in c) && c.tag === "stop");
    if (stops.length === 0) {
      const parent = this.ref(attr(el, "href") ?? attr(el, "xlink:href"));
      return parent && depth < 5 ? this.gradient(parent, depth + 1) : null;
    }
    this.warnings.add("Gradients were exported as a single shade");
    const colors = stops.map((s) => {
      const st = styleOf(s);
      const c = parseColor(st["stop-color"] ?? "black") ?? { lum: 0, alpha: 1 };
      return { lum: c.lum, alpha: c.alpha * opacity(st["stop-opacity"]) };
    });
    return {
      lum: colors.reduce((a, c) => a + c.lum, 0) / colors.length,
      alpha: colors.reduce((a, c) => a + c.alpha, 0) / colors.length,
    };
  }

  // --- Text ---

  renderText(el: XmlElement, ctx: Ctx, ops: Op[]) {
    if (!this.text) {
      this.warnings.add("Text was left out (fonts unavailable)");
      return;
    }
    const preserve = attr(el, "xml:space") === "preserve";
    const cursor = { x: this.len(el, "x", "w"), y: this.len(el, "y", "h") };
    const runs: { node: XmlNode; ctx: Ctx; at: { x?: number; y?: number } }[] = [];
    // Direct text and tspans, each with its own position and style.
    const walk = (nodes: XmlNode[], c: Ctx) => {
      for (const n of nodes) {
        if ("text" in n) runs.push({ node: n, ctx: c, at: {} });
        else if (n.tag === "tspan") {
          const own = styleOf(n);
          const style = { ...c.style };
          for (const [k, v] of Object.entries(own)) if (INHERITED.has(k)) style[k] = v;
          const at = {
            x: attr(n, "x") !== undefined ? this.len(n, "x", "w") : undefined,
            y: attr(n, "y") !== undefined ? this.len(n, "y", "h") : undefined,
          };
          runs.push({ node: { text: "" }, ctx: { ...c, style }, at });
          walk(n.children, { ...c, style });
        }
      }
    };
    walk(el.children, ctx);
    for (const { node, ctx: c, at } of runs) {
      if (at.x !== undefined) cursor.x = at.x;
      if (at.y !== undefined) cursor.y = at.y;
      if (!("text" in node) || !node.text) continue;
      const text = preserve ? node.text.replace(/[\r\n\t]/g, " ") : node.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const s = c.style;
      const weight = s["font-weight"] ?? "normal";
      const run: TextRun = {
        text,
        x: cursor.x,
        y: cursor.y,
        size: parseFloat(s["font-size"] ?? "16") || 16,
        mono: /mono|courier|consol|menlo/i.test(s["font-family"] ?? ""),
        bold: weight === "bold" || weight === "bolder" || Number(weight) >= 600,
        anchor: s["text-anchor"] === "middle" || s["text-anchor"] === "end" ? s["text-anchor"] : "start",
      };
      const { outlines, advance } = this.text(run, TOLERANCE / matrixScale(c.ctm));
      // Glyph contours follow the nonzero rule (TrueType outlines).
      this.paint(outlines, c, ops, true, FillRule.NonZero);
      cursor.x += run.anchor === "start" ? advance : 0;
    }
  }

  // --- Clipping and masking ---

  clipRegion(value: string, ctx: Ctx): PathsD | null {
    const el = this.ref(value);
    if (!el || el.tag !== "clipPath") return null;
    if (attr(el, "clipPathUnits") === "objectBoundingBox") {
      this.warnings.add("A clip path in bounding-box units was ignored");
      return null;
    }
    const base = multiply(ctx.ctm, parseTransform(attr(el, "transform")));
    const paths: PathsD = [];
    for (const child of el.children) {
      if ("text" in child || !SHAPES.has(child.tag)) continue;
      const m = multiply(base, parseTransform(attr(child, "transform")));
      const rule = styleOf(child)["clip-rule"] === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero;
      paths.push(...unite(transform(this.shape(child, TOLERANCE / matrixScale(m)).filter((l) => l.points.length > 2), m), rule));
    }
    return unite(paths, FillRule.NonZero);
  }

  /** Where a mask lets content through: its light parts, painted in order. */
  maskRegion(value: string, ctx: Ctx): PathsD | null {
    const el = this.ref(value);
    if (!el || el.tag !== "mask") return null;
    const ops: Op[] = [];
    this.collect(el.children, { ctm: ctx.ctm, style: {}, alpha: 1, depth: ctx.depth + 1 }, ops);
    let region = fold(ops, true);
    if (attr(el, "maskUnits") === "userSpaceOnUse" && attr(el, "width") && attr(el, "height")) {
      const bounds = rectPolyline(
        this.len(el, "x", "w"),
        this.len(el, "y", "h"),
        this.len(el, "width", "w"),
        this.len(el, "height", "h"),
        0,
        0,
        1,
      );
      region = Clipper.intersectD(region, transform([bounds], ctx.ctm), FillRule.NonZero, PRECISION);
    }
    return region;
  }
}

const SHAPES = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);

function attr(el: XmlElement, name: string): string | undefined {
  return el.attrs.find(([k]) => k === name)?.[1];
}

/** Presentation attributes overlaid with style="…" declarations. */
function styleOf(el: XmlElement): Style {
  const style: Style = {};
  for (const [k, v] of el.attrs) if (k !== "style") style[k] = v.trim();
  for (const decl of (attr(el, "style") ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) style[decl.slice(0, i).trim()] = decl.slice(i + 1).replace(/!important/i, "").trim();
  }
  return style;
}

function opacity(value: string | undefined): number {
  if (value === undefined) return 1;
  const n = value.trim().endsWith("%") ? parseFloat(value) / 100 : parseFloat(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function parseColor(value: string): Color | null {
  let v = value.trim().toLowerCase();
  v = NAMED_COLORS[v] ?? v;
  let r: number, g: number, b: number;
  let alpha = 1;
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  const fn = /^rgba?\(([^)]*)\)$/.exec(v);
  if (hex) {
    const h = hex[1];
    const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
    [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    if (full.length === 8) alpha = parseInt(full.slice(6, 8), 16) / 255;
  } else if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (p: string) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p));
    [r, g, b] = parts.slice(0, 3).map(channel);
    if (parts[3] !== undefined) alpha = opacity(parts[3]);
  } else {
    return null;
  }
  if (![r, g, b].every(Number.isFinite)) return null;
  // Rec. 601 luma, as in niimbot-raster.ts.
  return { lum: 0.299 * r + 0.587 * g + 0.114 * b, alpha };
}

/**
 * Dark paint adds ink, light paint removes it; paint that is mostly
 * transparent changes nothing. Same 50 % threshold as the thermal printers.
 */
function classify(color: Color | null, alpha: number): boolean | null {
  if (!color || color.alpha * alpha < 0.5) return null;
  return color.lum < 128;
}

// Clipper's one-argument unionD ignores the precision, so go through booleanOpD.
const unite = (paths: PathsD, rule: FillRule) =>
  paths.length ? Clipper.booleanOpD(ClipType.Union, paths, null, rule, PRECISION) : [];

function transform(lines: Polyline[], m: Matrix): PathsD {
  const identity = m.every((v, i) => v === IDENTITY[i]);
  return lines.map((l) => (identity ? l.points.map((p) => ({ x: p.x, y: p.y })) : l.points.map((p) => applyMatrix(m, p))));
}

/**
 * Applies paint operations in order. Normally dark adds and light removes;
 * `invert` is for masks, where light lets content through.
 */
function fold(ops: Op[], invert = false): PathsD {
  let ink: PathsD = [];
  let pending: PathsD = [];
  let adding: boolean | null = null;
  const flush = () => {
    if (adding === null || pending.length === 0) return;
    ink = adding
      ? Clipper.unionD(ink, pending, FillRule.NonZero, PRECISION)
      : Clipper.differenceD(ink, pending, FillRule.NonZero, PRECISION);
    pending = [];
  };
  for (const op of ops) {
    const add = invert ? !op.dark : op.dark;
    if (add !== adding) {
      flush();
      adding = add;
    }
    pending.push(...op.region);
  }
  flush();
  return ink;
}

const fmt = (v: number) => +v.toFixed(PRECISION);

/**
 * The SVG with all drawing replaced by one filled path at the same size and
 * viewBox. `warnings` lists anything approximated or left out.
 */
export function outlineSvg(svg: string, text: TextOutliner | null): { svg: string; warnings: string[] } {
  const nodes = parseXml(svg);
  const root = nodes?.find((n): n is XmlElement => !("text" in n) && n.tag === "svg");
  if (!root) throw new Error("Not an SVG document");
  const o = new Outliner(text);
  o.index(root.children);
  const viewBox = (attr(root, "viewBox") ?? "").split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite)) o.viewport = { w: viewBox[2], h: viewBox[3] };
  else o.viewport = { w: parseFloat(attr(root, "width") ?? "100") || 100, h: parseFloat(attr(root, "height") ?? "100") || 100 };

  const ops: Op[] = [];
  o.collect(root.children, { ctm: IDENTITY, style: {}, alpha: 1, depth: 0 }, ops);
  const ink = fold(ops);
  const d = ink
    .filter((p) => p.length > 2)
    .map((p) => `M${p.map((pt) => `${fmt(pt.x)} ${fmt(pt.y)}`).join("L")}Z`)
    .join("");
  const keep = ["width", "height", "viewBox"]
    .map((k) => [k, attr(root, k)] as const)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v!.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}"`)
    .join("");
  return {
    // evenodd: holes come out as separate contours, which every importer reads.
    svg: `<svg xmlns="http://www.w3.org/2000/svg"${keep}>${d ? `<path fill="#000" fill-rule="evenodd" d="${d}"/>` : ""}</svg>`,
    warnings: [...o.warnings],
  };
}
