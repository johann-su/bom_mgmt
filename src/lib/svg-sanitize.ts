// Turns an uploaded or pasted SVG into markup that is safe to inline into a
// label — in the designer's DOM (dangerouslySetInnerHTML), in downloads and
// in PDFs. SVG is a script-capable document format, so this is an allowlist
// rebuild, not a blocklist filter: the source is tokenised, and only known
// drawing elements and presentation attributes are written back out, freshly
// escaped. Nothing from the source is passed through verbatim.
//
// It is plain string code (no DOM), so the server re-runs it on every saved
// template (parseTemplate) and it is unit-testable under node:test.
//
// Dropped: scripts, event handlers, foreignObject, <image>, external or
// javascript: links, any url() that isn't a local #reference, CSS beyond
// simple `.class { … }` rules (which are inlined as attributes), and editor
// metadata (Inkscape/Illustrator namespaces).

export type ImportedSvg = { viewBox: [number, number, number, number]; markup: string };

// Sanitised markup per graphic; keeps a saved template far below the 1 MB
// server-action body limit even with a few graphics.
export const MAX_GRAPHIC_MARKUP = 150_000;
const MAX_SOURCE = 2_000_000;
const MAX_NODES = 20_000;
const MAX_DEPTH = 64;

// Drawing elements kept as they are. A nested <svg> becomes a <g>.
const ELEMENTS = new Set([
  "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "clipPath", "mask", "linearGradient", "radialGradient", "stop",
  "use", "symbol", "text", "tspan",
]);
// Harmless wrappers whose children are kept without the wrapper itself.
const UNWRAP = new Set(["a", "switch"]);
// Elements whose text content means something.
const TEXT_ELEMENTS = new Set(["text", "tspan"]);

// Properties allowed both as attributes and inside style="…" / <style>.
const PAINT = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "mask", "stop-color",
  "stop-opacity", "display", "visibility", "font-size", "font-family", "font-weight",
  "font-style", "text-anchor", "dominant-baseline", "letter-spacing", "color",
  "vector-effect", "paint-order",
]);
const GEOMETRY = new Set([
  "id", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy",
  "width", "height", "points", "offset", "dx", "dy", "pathLength", "transform",
  "gradientTransform", "gradientUnits", "spreadMethod", "clipPathUnits", "maskUnits",
  "maskContentUnits", "viewBox", "preserveAspectRatio",
]);
// Elements that may point at another one (only ever a local #id).
const LINKING = new Set(["use", "linearGradient", "radialGradient"]);
// Path data can be long; everything else is short.
const LONG_VALUES = new Set(["d", "points"]);

// --- Tokenising ---

export type XmlElement = { tag: string; attrs: [string, string][]; children: XmlNode[] };
export type XmlNode = XmlElement | { text: string };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

// Only the predefined and numeric entities; DOCTYPE-declared ones are not
// expanded (no "billion laughs").
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? "";
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

/** A permissive-but-strict XML tokeniser: anything it can't read rejects the file. */
export function parseXml(src: string): XmlNode[] | null {
  const root: XmlElement = { tag: "#root", attrs: [], children: [] };
  const stack = [root];
  let i = 0;
  let nodes = 0;
  const skipTo = (end: string) => {
    const at = src.indexOf(end, i);
    if (at < 0) return false;
    i = at + end.length;
    return true;
  };
  while (i < src.length) {
    if (++nodes > MAX_NODES) return null;
    const top = stack[stack.length - 1];
    if (src.startsWith("<!--", i)) {
      if (!skipTo("-->")) return null;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i);
      if (end < 0) return null;
      top.children.push({ text: src.slice(i + 9, end) });
      i = end + 3;
    } else if (src.startsWith("<!", i)) {
      // DOCTYPE, possibly with an internal subset in [ … ].
      const bracket = src.indexOf("[", i);
      const close = src.indexOf(">", i);
      if (close < 0) return null;
      if (bracket >= 0 && bracket < close) {
        if (!skipTo("]")) return null;
      }
      if (!skipTo(">")) return null;
    } else if (src.startsWith("<?", i)) {
      if (!skipTo("?>")) return null;
    } else if (src.startsWith("</", i)) {
      const m = /^<\/([A-Za-z_][\w.:-]*)\s*>/.exec(src.slice(i, i + 200));
      if (!m || stack.length < 2 || top.tag !== m[1]) return null;
      stack.pop();
      i += m[0].length;
    } else if (src[i] === "<") {
      const name = /^<([A-Za-z_][\w.:-]*)/.exec(src.slice(i, i + 200));
      if (!name) return null;
      i += name[0].length;
      const el: XmlElement = { tag: name[1], attrs: [], children: [] };
      for (;;) {
        const ws = /^\s*/.exec(src.slice(i, i + 1000))![0].length;
        i += ws;
        if (src.startsWith("/>", i)) {
          i += 2;
          top.children.push(el);
          break;
        }
        if (src[i] === ">") {
          i += 1;
          top.children.push(el);
          if (stack.length > MAX_DEPTH) return null;
          stack.push(el);
          break;
        }
        if (ws === 0 && el.attrs.length > 0) return null;
        const attr = /^([^\s=/>"']+)\s*=\s*/.exec(src.slice(i, i + 300));
        if (!attr) return null;
        i += attr[0].length;
        const quote = src[i];
        if (quote !== '"' && quote !== "'") return null;
        const end = src.indexOf(quote, i + 1);
        if (end < 0) return null;
        el.attrs.push([attr[1], decodeEntities(src.slice(i + 1, end))]);
        i = end + 1;
      }
    } else {
      const next = src.indexOf("<", i);
      const end = next < 0 ? src.length : next;
      top.children.push({ text: decodeEntities(src.slice(i, end)) });
      i = end;
    }
  }
  return stack.length === 1 ? root.children : null;
}

// --- Rebuilding ---

const escapeAttr = (v: string) => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const escapeText = (v: string) => v.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const ID_RE = /^[A-Za-z_][\w.-]*$/;
const URL_RE = /url\(\s*(['"]?)#([A-Za-z_][\w.-]*)\1\s*\)/g;

/** `.a, .b { fill: red }` rules from <style> blocks, by class name. */
function classRules(css: string): Map<string, [string, string][]> {
  const rules = new Map<string, [string, string][]>();
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of cleaned.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = declarations(body);
    for (const selector of selectors.split(",")) {
      const m = /^\s*\.([\w-]+)\s*$/.exec(selector);
      if (m) rules.set(m[1], [...(rules.get(m[1]) ?? []), ...decls]);
    }
  }
  return rules;
}

function declarations(css: string): [string, string][] {
  return css
    .split(";")
    .map((d) => {
      const colon = d.indexOf(":");
      return [d.slice(0, colon).trim().toLowerCase(), d.slice(colon + 1).replace(/!important/i, "").trim()] as [
        string,
        string,
      ];
    })
    .filter(([k, v]) => k && v && PAINT.has(k));
}

function styleText(nodes: XmlNode[]): string {
  let css = "";
  for (const node of nodes) {
    if ("text" in node) continue;
    if (node.tag === "style") css += node.children.map((c) => ("text" in c ? c.text : "")).join("");
    else css += styleText(node.children);
  }
  return css;
}

type Context = { prefix: string; classes: Map<string, [string, string][]>; nodes: number };

/** A safe attribute value, with local references renamed — or null to drop it. */
function cleanValue(name: string, value: string, ctx: Context): string | null {
  if (value.length > (LONG_VALUES.has(name) ? 100_000 : 2_000)) return null;
  if (name === "id") return ID_RE.test(value) ? ctx.prefix + value : null;
  if (name === "href") {
    const m = /^#([A-Za-z_][\w.-]*)$/.exec(value.trim());
    return m ? `#${ctx.prefix}${m[1]}` : null;
  }
  // No CSS escapes, at-rules or script-ish values; url() only to #ids here.
  if (/[\\@]|javascript:|expression\s*\(/i.test(value)) return null;
  const renamed = value.replace(URL_RE, (_, _q, id: string) => `url(#${ctx.prefix}${id})`);
  // Any url() left over points somewhere outside the document.
  if (/url\s*\(/i.test(renamed.replace(/url\(#[\w.-]+\)/g, ""))) return null;
  return renamed;
}

function serialize(nodes: XmlNode[], ctx: Context, inText: boolean): string {
  let out = "";
  for (const node of nodes) {
    if (++ctx.nodes > MAX_NODES) throw new Error("too large");
    if ("text" in node) {
      if (inText) out += escapeText(node.text);
      continue;
    }
    if (UNWRAP.has(node.tag)) {
      out += serialize(node.children, ctx, inText);
      continue;
    }
    const tag = node.tag === "svg" ? "g" : node.tag;
    if (!ELEMENTS.has(tag)) continue;
    out += `<${tag}${attributes(node, ctx, tag)}`;
    const inner = serialize(node.children, ctx, TEXT_ELEMENTS.has(tag));
    out += inner ? `>${inner}</${tag}>` : "/>";
  }
  return out;
}

// Precedence as in CSS: attributes, then class rules, then style="…".
function attributes(node: XmlElement, ctx: Context, tag: string): string {
  const values = new Map<string, string>();
  const set = (name: string, value: string) => {
    const clean = cleanValue(name, value, ctx);
    if (clean !== null) values.set(name, clean);
  };
  for (const [rawName, value] of node.attrs) {
    const name = rawName === "xlink:href" ? "href" : rawName;
    // A nested <svg>'s own viewport doesn't carry over to the <g> it becomes.
    if (node.tag === "svg" && ["x", "y", "width", "height", "viewBox", "preserveAspectRatio"].includes(name)) continue;
    if (name === "href" ? LINKING.has(tag) : PAINT.has(name) || GEOMETRY.has(name)) set(name, value);
  }
  const classes = node.attrs.find(([n]) => n === "class")?.[1].split(/\s+/) ?? [];
  for (const c of classes) for (const [k, v] of ctx.classes.get(c) ?? []) set(k, v);
  const style = node.attrs.find(([n]) => n === "style")?.[1];
  if (style) for (const [k, v] of declarations(style)) set(k, v);
  return [...values].map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
}

// FNV-1a — a short, stable tag for one graphic's ids.
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

function parseViewBox(root: XmlElement): ImportedSvg["viewBox"] | null {
  const attr = (n: string) => root.attrs.find(([k]) => k === n)?.[1];
  const viewBox = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return viewBox as ImportedSvg["viewBox"];
  }
  // No viewBox: fall back to width/height, whatever their unit.
  const w = parseFloat(attr("width") ?? "");
  const h = parseFloat(attr("height") ?? "");
  return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? [0, 0, w, h] : null;
}

/**
 * Imports a complete SVG file (or "Copy as SVG" text): its viewBox and the
 * cleaned drawing. Ids are prefixed per file, so two graphics on one label
 * can't hijack each other's gradients or clip paths.
 */
export function importSvg(source: string): ImportedSvg | { error: string } {
  if (source.length > MAX_SOURCE) return { error: "That SVG is too large (max 2 MB)" };
  const nodes = parseXml(source);
  if (!nodes) return { error: "That isn't a readable SVG file" };
  const root = nodes.find((n): n is XmlElement => !("text" in n));
  if (!root || root.tag !== "svg") return { error: "That isn't an SVG file" };
  const viewBox = parseViewBox(root);
  if (!viewBox) return { error: "The SVG has no size (no viewBox or width/height)" };
  const ctx: Context = { prefix: `g${hash(source)}-`, classes: classRules(styleText(root.children)), nodes: 0 };
  let markup: string;
  try {
    // The root's own paint (fill="none" on icon sets, say) moves to a <g>.
    const paintOnly = root.attrs.filter(([k]) => PAINT.has(k) || k === "style" || k === "class");
    const rootPaint = attributes({ ...root, attrs: paintOnly }, ctx, "g");
    const body = serialize(root.children, ctx, false);
    markup = rootPaint && body ? `<g${rootPaint}>${body}</g>` : body;
  } catch {
    return { error: "That SVG is too complex" };
  }
  if (!markup) return { error: "The SVG has nothing drawable in it" };
  if (markup.length > MAX_GRAPHIC_MARKUP) return { error: "That SVG is too detailed (max 150 kB once cleaned up)" };
  return { viewBox, markup };
}

/**
 * Re-cleans stored markup (a saved template, a paste of elements). Output of
 * `importSvg` comes back unchanged; anything else is rebuilt the same way.
 * Returns null for unreadable or empty markup.
 */
export function sanitizeSvgMarkup(markup: string): string | null {
  if (markup.length > MAX_GRAPHIC_MARKUP) return null;
  const nodes = parseXml(markup);
  if (!nodes) return null;
  try {
    const out = serialize(nodes, { prefix: "", classes: new Map(), nodes: 0 }, false);
    return out || null;
  } catch {
    return null;
  }
}
