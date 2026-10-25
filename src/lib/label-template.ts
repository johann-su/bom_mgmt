// Printable label templates — the sticker on a shelf, box or bin. Not to be
// confused with label *patterns* (src/lib/label-pattern.ts), which name the
// locations; a template lays out how one location's identifier, a scannable
// code and some text are printed.
//
// A template is plain JSON (stored in `label_templates.template`): a label
// size in mm, elements positioned in mm from the top-left corner, and how
// labels go onto paper (one label per page for label printers, or a grid on a
// sheet for A4/Letter label stock). Text and code contents may contain
// `{{variables}}` filled per location (see `locationVariables`), so one
// template prints a whole series of bins.

import { locationCode, locationPath } from "@/lib/location-tree";
import { sanitizeSvgMarkup } from "@/lib/svg-sanitize";

export const SYMBOLOGIES = {
  datamatrix: { name: "Data Matrix", twoD: true },
  qrcode: { name: "QR code", twoD: true },
  code128: { name: "Code 128", twoD: false },
  code39: { name: "Code 39", twoD: false },
} as const;
export type Symbology = keyof typeof SYMBOLOGIES;

type Box = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // Degrees clockwise about the box's centre, in [0, 360); absent when 0.
  // x/y/w/h stay the unrotated box, so turning an element never moves it.
  rotation?: number;
};

// How a frame, or the box behind a text, is drawn. Colours are "#rrggbb";
// thermal printers print each as black or white (see niimbot-raster.ts).
export type BoxStyle = {
  // Absent → transparent.
  fill?: string;
  // Absent → black.
  stroke?: string;
  // mm; 0 → no border.
  strokeWidth: number;
  radius: number;
};

// A text or graphic element can be a named *slot*: the template sets its
// box, style and default content, and each location may fill it with its
// own text or graphic (src/lib/label-slots.ts) — the screw-head symbol on
// one bin's label, while the layout stays shared by every bin.
type Slotted = { slot?: string };

export type TextElement = Box & Partial<BoxStyle> & Slotted & {
  kind: "text";
  // Absent → black.
  color?: string;
  text: string;
  // Points, as in every word processor; converted to mm when rendering.
  fontSize: number;
  bold: boolean;
  mono: boolean;
  align: "start" | "middle" | "end";
  // Shrink the font so the longest line fits the box width.
  fit: boolean;
};

export type CodeElement = Box & { kind: "code"; text: string; symbology: Symbology };

export type FrameElement = Box & BoxStyle & { kind: "frame" };

// A vector graphic (logo, warning symbol, icon) imported from SVG. `markup`
// is the sanitised drawing (svg-sanitize.ts) in `viewBox` units; it is
// scaled into the box, centred, keeping its proportions unless `stretch`.
export type GraphicElement = Box & Slotted & {
  kind: "graphic";
  markup: string;
  viewBox: [number, number, number, number];
  stretch: boolean;
  // Original file name, for the element list.
  name?: string;
};

export type LabelElement = TextElement | CodeElement | FrameElement | GraphicElement;

/** Where a newly added graphic goes: centred, as large as fits with a 1 mm margin. */
export function graphicBox(
  label: { width: number; height: number },
  viewBox: GraphicElement["viewBox"],
): { x: number; y: number; w: number; h: number } {
  const aspect = viewBox[2] / viewBox[3];
  const h = Math.max(1, Math.min(label.height - 2, (label.width - 2) / aspect));
  const w = h * aspect;
  const r = (v: number) => +v.toFixed(2);
  return { x: r((label.width - w) / 2), y: r((label.height - h) / 2), w: r(w), h: r(h) };
}

export type PageLayout =
  | { kind: "single" }
  | {
      kind: "sheet";
      pageWidth: number;
      pageHeight: number;
      columns: number;
      rows: number;
      marginTop: number;
      marginLeft: number;
      gapX: number;
      gapY: number;
    };

export type LabelTemplate = {
  width: number;
  height: number;
  elements: LabelElement[];
  layout: PageLayout;
};

// --- Slots ---

// Slot names key per-location values, so they are short, stable slugs.
export const SLOT_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Turns what the user typed into a slot name ("Screw head" → "screw-head"); "" when nothing usable is left. */
export function slotName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return SLOT_NAME_RE.test(slug) ? slug : "";
}

// --- Variables ---

export const LABEL_VARIABLES = {
  code: "Full code, e.g. A/1/IV",
  label: "This location's own label, e.g. IV",
  type: "Location type, e.g. Bin",
  name: "Location name (may be empty)",
  description: "Location description (may be empty)",
  path: "Human path, e.g. Shelf A › Box 1 › Bin IV",
  parent: "Parent's code, e.g. A/1",
  url: "Link to the location's page in this app",
  id: "Location id (UUID)",
} as const;
export type LabelVariable = keyof typeof LABEL_VARIABLES;
export type LabelVariables = Record<LabelVariable, string>;

const VARIABLE_RE = /\{\{\s*([a-z]+)\s*\}\}/g;

/** Replaces `{{name}}` placeholders; unknown names become empty. */
export function fillVariables(text: string, vars: Partial<LabelVariables>): string {
  return text.replace(VARIABLE_RE, (_, name: string) =>
    name in LABEL_VARIABLES ? (vars[name as LabelVariable] ?? "") : "",
  );
}

/** Placeholder names a template uses that don't exist — for the designer to warn about. */
export function unknownVariables(template: LabelTemplate): string[] {
  const unknown = new Set<string>();
  for (const el of template.elements) {
    if (el.kind === "frame" || el.kind === "graphic") continue;
    for (const [, name] of el.text.matchAll(VARIABLE_RE)) {
      if (!(name in LABEL_VARIABLES)) unknown.add(name);
    }
  }
  return [...unknown];
}

/**
 * The variables for one location, from its chain of ancestors (root first,
 * the location itself last — as `ancestry` in location-tree.ts returns it).
 */
export function locationVariables(
  chain: { id: string; label: string; name: string; type: { name: string } }[],
  extra: { url: string; description?: string; separator?: string },
): LabelVariables {
  const self = chain[chain.length - 1];
  return {
    code: locationCode(chain, extra.separator),
    label: self?.label ?? "",
    type: self?.type.name ?? "",
    name: self?.name ?? "",
    description: extra.description ?? "",
    path: locationPath(chain),
    parent: locationCode(chain.slice(0, -1), extra.separator),
    url: extra.url,
    id: self?.id ?? "",
  };
}

// --- Sheet layout ---

export const SHEET_PRESETS: { name: string; label: [number, number]; layout: PageLayout }[] = [
  {
    name: "Avery L7651 / 3666 (A4, 65 per sheet)",
    label: [38.1, 21.2],
    layout: {
      kind: "sheet", pageWidth: 210, pageHeight: 297, columns: 5, rows: 13,
      marginTop: 10.7, marginLeft: 4.75, gapX: 2.5, gapY: 0,
    },
  },
  {
    name: "Avery L7160 (A4, 21 per sheet)",
    label: [63.5, 38.1],
    layout: {
      kind: "sheet", pageWidth: 210, pageHeight: 297, columns: 3, rows: 7,
      marginTop: 15.15, marginLeft: 7.25, gapX: 2.5, gapY: 0,
    },
  },
  {
    name: "Avery 5160 (Letter, 30 per sheet)",
    label: [66.675, 25.4],
    layout: {
      kind: "sheet", pageWidth: 215.9, pageHeight: 279.4, columns: 3, rows: 10,
      marginTop: 12.7, marginLeft: 4.7625, gapX: 3.175, gapY: 0,
    },
  },
];

export type Placement = { page: number; x: number; y: number };

/**
 * Where each of `count` labels goes: page index and top-left corner in mm.
 * `skip` leaves the first cells of the first sheet empty, so a partly used
 * sheet can be fed through again. A single-label layout puts every label on
 * its own page at the origin.
 */
export function placeLabels(template: LabelTemplate, count: number, skip = 0): Placement[] {
  const { layout } = template;
  if (layout.kind === "single") {
    return Array.from({ length: count }, (_, page) => ({ page, x: 0, y: 0 }));
  }
  const perPage = Math.max(1, layout.columns * layout.rows);
  return Array.from({ length: count }, (_, i) => {
    const cell = i + Math.max(0, Math.floor(skip));
    const onPage = cell % perPage;
    const col = onPage % layout.columns;
    const row = Math.floor(onPage / layout.columns);
    return {
      page: Math.floor(cell / perPage),
      x: layout.marginLeft + col * (template.width + layout.gapX),
      y: layout.marginTop + row * (template.height + layout.gapY),
    };
  });
}

export function pageSize(template: LabelTemplate): { width: number; height: number } {
  return template.layout.kind === "single"
    ? { width: template.width, height: template.height }
    : { width: template.layout.pageWidth, height: template.layout.pageHeight };
}

// --- Validation ---

const MAX_SIZE = 1000; // mm — anything larger is a typo, not a label
const MAX_ELEMENTS = 50;
const MAX_GRAPHICS_TOTAL = 600_000;

function num(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

// Colours go into SVG attributes, so only plain hex gets through.
function color(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

/** The style fields that are set, so unstyled elements stay as they were. */
function boxStyle(e: Record<string, unknown>): Partial<BoxStyle> {
  const style: Partial<BoxStyle> = {
    fill: color(e.fill),
    stroke: color(e.stroke),
    strokeWidth: num(e.strokeWidth, 0, 10) ?? undefined,
    radius: num(e.radius, 0, MAX_SIZE) ?? undefined,
  };
  for (const k of Object.keys(style) as (keyof BoxStyle)[]) if (style[k] === undefined) delete style[k];
  return style;
}

function slotOf(e: Record<string, unknown>): { slot?: string } {
  return typeof e.slot === "string" && SLOT_NAME_RE.test(e.slot) ? { slot: e.slot } : {};
}

/**
 * Checks untrusted JSON (a form submission, a stored row) and returns a clean
 * template, dropping unknown fields. Elements may hang off the label edge —
 * that's how a frame bleeds — but sizes must be positive.
 */
export function parseTemplate(input: unknown): LabelTemplate | { error: string } {
  if (!input || typeof input !== "object") return { error: "Template must be an object" };
  const t = input as Record<string, unknown>;
  const width = num(t.width, 1, MAX_SIZE);
  const height = num(t.height, 1, MAX_SIZE);
  if (width === null || height === null) return { error: `Label size must be 1–${MAX_SIZE} mm` };
  if (!Array.isArray(t.elements)) return { error: "Elements must be a list" };
  if (t.elements.length > MAX_ELEMENTS) return { error: `At most ${MAX_ELEMENTS} elements` };

  const elements: LabelElement[] = [];
  let graphicBytes = 0;
  for (const [i, raw] of t.elements.entries()) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const box = {
      id: typeof e.id === "string" && e.id ? e.id.slice(0, 64) : `el${i}`,
      x: num(e.x, -MAX_SIZE, MAX_SIZE),
      y: num(e.y, -MAX_SIZE, MAX_SIZE),
      w: num(e.w, 0.1, MAX_SIZE),
      h: num(e.h, 0.1, MAX_SIZE),
    };
    if (box.x === null || box.y === null || box.w === null || box.h === null) {
      return { error: `Element ${i + 1} has an invalid position or size` };
    }
    const pos = box as Box;
    // Normalised to [0, 360) so 90 and -270 are stored alike; 0 is left out.
    const rotation = +((((num(e.rotation, -360, 360) ?? 0) % 360) + 360) % 360).toFixed(1) % 360;
    if (rotation) pos.rotation = rotation;
    const text = typeof e.text === "string" ? e.text.slice(0, 500) : "";
    if (e.kind === "text") {
      const fontSize = num(e.fontSize, 1, 400);
      if (fontSize === null) return { error: `Element ${i + 1}: font size must be 1–400 pt` };
      const align = e.align === "middle" || e.align === "end" ? e.align : "start";
      const textColor = color(e.color);
      elements.push({
        ...slotOf(e),
        ...pos, kind: "text", text, fontSize, align,
        bold: e.bold === true, mono: e.mono === true, fit: e.fit === true,
        ...(textColor ? { color: textColor } : {}),
        ...boxStyle(e),
      });
    } else if (e.kind === "code") {
      if (typeof e.symbology !== "string" || !(e.symbology in SYMBOLOGIES)) {
        return { error: `Element ${i + 1}: unknown code type` };
      }
      elements.push({ ...pos, kind: "code", text, symbology: e.symbology as Symbology });
    } else if (e.kind === "frame") {
      elements.push({ ...pos, kind: "frame", strokeWidth: 0.3, radius: 0, ...boxStyle(e) });
    } else if (e.kind === "graphic") {
      // Never trust stored markup: it is re-sanitised on every save and load.
      const markup = typeof e.markup === "string" ? sanitizeSvgMarkup(e.markup) : null;
      const vb = Array.isArray(e.viewBox) ? e.viewBox.map((v) => num(v, -1e6, 1e6)) : [];
      if (!markup || vb.length !== 4 || vb.some((v) => v === null) || vb[2]! <= 0 || vb[3]! <= 0) {
        return { error: `Element ${i + 1}: invalid graphic` };
      }
      graphicBytes += markup.length;
      const name = typeof e.name === "string" ? e.name.slice(0, 100) : "";
      elements.push({
        ...slotOf(e),
        ...pos, kind: "graphic", markup, viewBox: vb as GraphicElement["viewBox"], stretch: e.stretch === true,
        ...(name ? { name } : {}),
      });
    } else {
      return { error: `Element ${i + 1} has an unknown kind` };
    }
  }

  // Keeps a template well under the 1 MB server-action body limit.
  if (graphicBytes > MAX_GRAPHICS_TOTAL) return { error: "The graphics on this label are too large in total" };

  const l = (t.layout ?? { kind: "single" }) as Record<string, unknown>;
  let layout: PageLayout;
  if (l.kind === "sheet") {
    const sheet = {
      pageWidth: num(l.pageWidth, 1, MAX_SIZE),
      pageHeight: num(l.pageHeight, 1, MAX_SIZE),
      columns: num(l.columns, 1, 100),
      rows: num(l.rows, 1, 200),
      marginTop: num(l.marginTop, 0, MAX_SIZE),
      marginLeft: num(l.marginLeft, 0, MAX_SIZE),
      gapX: num(l.gapX, 0, MAX_SIZE),
      gapY: num(l.gapY, 0, MAX_SIZE),
    };
    if (Object.values(sheet).some((v) => v === null)) return { error: "Invalid sheet layout" };
    const s = sheet as Omit<Extract<PageLayout, { kind: "sheet" }>, "kind">;
    s.columns = Math.floor(s.columns);
    s.rows = Math.floor(s.rows);
    // The grid has to fit the paper or the last column/row prints off the edge.
    const right = s.marginLeft + s.columns * width + (s.columns - 1) * s.gapX;
    const bottom = s.marginTop + s.rows * height + (s.rows - 1) * s.gapY;
    if (right > s.pageWidth + 0.01 || bottom > s.pageHeight + 0.01) {
      return { error: "The label grid doesn't fit on the page" };
    }
    layout = { kind: "sheet", ...s };
  } else {
    layout = { kind: "single" };
  }

  return { width, height, elements, layout };
}

// --- Starting points ---

export const DEFAULT_TEMPLATES: { name: string; template: LabelTemplate }[] = [
  {
    name: "Bin 40×20 — Data Matrix",
    template: {
      width: 40,
      height: 20,
      layout: { kind: "single" },
      elements: [
        { id: "code", kind: "code", x: 2, y: 2, w: 16, h: 16, symbology: "datamatrix", text: "{{code}}" },
        {
          id: "big", kind: "text", x: 20, y: 2, w: 18, h: 10, text: "{{code}}",
          fontSize: 16, bold: true, mono: true, align: "start", fit: true,
        },
        {
          id: "small", kind: "text", x: 20, y: 12, w: 18, h: 6, text: "{{name}}",
          fontSize: 7, bold: false, mono: false, align: "start", fit: true,
        },
      ],
    },
  },
  {
    name: "Box 62×29 — QR link",
    template: {
      width: 62,
      height: 29,
      layout: { kind: "single" },
      elements: [
        { id: "code", kind: "code", x: 2, y: 2, w: 25, h: 25, symbology: "qrcode", text: "{{url}}" },
        {
          id: "type", kind: "text", x: 29, y: 2, w: 31, h: 6, text: "{{type}}",
          fontSize: 8, bold: false, mono: false, align: "start", fit: true,
        },
        {
          id: "big", kind: "text", x: 29, y: 8, w: 31, h: 12, text: "{{code}}",
          fontSize: 22, bold: true, mono: true, align: "start", fit: true,
        },
        {
          id: "name", kind: "text", x: 29, y: 20, w: 31, h: 7, text: "{{name}}",
          fontSize: 9, bold: false, mono: false, align: "start", fit: true,
        },
      ],
    },
  },
  // NIIMBOT rolls. The D11/D110 head is 12 mm (96 dots) across, and labels
  // run through sideways, so the label's height is the limit; the B1's head
  // is 48 mm and labels feed top-first.
  {
    name: "NIIMBOT D11/D110 40×12",
    template: {
      width: 40,
      height: 12,
      layout: { kind: "single" },
      elements: [
        { id: "code", kind: "code", x: 1.5, y: 1, w: 10, h: 10, symbology: "datamatrix", text: "{{code}}" },
        {
          id: "big", kind: "text", x: 13, y: 1, w: 25.5, h: 6.5, text: "{{code}}",
          fontSize: 14, bold: true, mono: true, align: "start", fit: true,
        },
        {
          id: "small", kind: "text", x: 13, y: 7.5, w: 25.5, h: 3.5, text: "{{name}}",
          fontSize: 7, bold: false, mono: false, align: "start", fit: true,
        },
      ],
    },
  },
  {
    name: "NIIMBOT B1 50×30",
    template: {
      width: 50,
      height: 30,
      layout: { kind: "single" },
      elements: [
        { id: "code", kind: "code", x: 2, y: 2, w: 20, h: 20, symbology: "qrcode", text: "{{url}}" },
        {
          id: "type", kind: "text", x: 24, y: 2, w: 24, h: 5, text: "{{type}}",
          fontSize: 8, bold: false, mono: false, align: "start", fit: true,
        },
        {
          id: "big", kind: "text", x: 24, y: 7, w: 24, h: 12, text: "{{code}}",
          fontSize: 20, bold: true, mono: true, align: "start", fit: true,
        },
        {
          id: "name", kind: "text", x: 2, y: 23, w: 46, h: 5, text: "{{name}}",
          fontSize: 9, bold: false, mono: false, align: "start", fit: true,
        },
      ],
    },
  },
  {
    name: "Avery L7651 sheet — barcode",
    template: {
      width: 38.1,
      height: 21.2,
      layout: SHEET_PRESETS[0].layout,
      elements: [
        {
          id: "big", kind: "text", x: 2, y: 1.5, w: 34.1, h: 8, text: "{{code}}",
          fontSize: 14, bold: true, mono: true, align: "middle", fit: true,
        },
        { id: "code", kind: "code", x: 3, y: 10, w: 32.1, h: 9.5, symbology: "code128", text: "{{code}}" },
      ],
    },
  },
];

/** Stand-in values for previews in the designer and the template list. */
export const SAMPLE_VARIABLES: LabelVariables = {
  code: "A/1/IV",
  label: "IV",
  type: "Bin",
  name: "M3 heat-set inserts",
  description: "M3 × 5.7 mm, brass",
  path: "Shelf A › Box 1 › Bin IV",
  parent: "A/1",
  url: "https://inventory.example/locations/0b7e2f8c-4f0e-4a43-9d1a-2f6f1d9c0a11",
  id: "0b7e2f8c-4f0e-4a43-9d1a-2f6f1d9c0a11",
};

// --- Which template a location gets ---

/** A template the user can pick: a saved row (`key` = its id) or a built-in. */
export type TemplateOption = { key: string; name: string; template: LabelTemplate; builtIn: boolean };

const BUILT_IN_PREFIX = "builtin-";

export function builtInIndex(key: string): number | null {
  if (!key.startsWith(BUILT_IN_PREFIX)) return null;
  const index = Number(key.slice(BUILT_IN_PREFIX.length));
  return Number.isInteger(index) && DEFAULT_TEMPLATES[index] ? index : null;
}

/** Saved templates first (by name, as loaded), then the built-ins. */
export function templateOptions(
  saved: { id: string; name: string; template: LabelTemplate }[],
): TemplateOption[] {
  return [
    ...saved.map((t) => ({ key: t.id, name: t.name, template: t.template, builtIn: false })),
    ...DEFAULT_TEMPLATES.map((t, i) => ({
      key: `${BUILT_IN_PREFIX}${i}`,
      name: t.name,
      template: t.template,
      builtIn: true,
    })),
  ];
}

/**
 * The template a location type prints with: its assigned saved template, or
 * the first built-in when none is assigned (or the assigned one is gone).
 */
export function templateForType(options: TemplateOption[], labelTemplateId: string | null): TemplateOption {
  return (
    (labelTemplateId && options.find((o) => o.key === labelTemplateId)) ||
    options.find((o) => o.builtIn) ||
    options[0]
  );
}

/** `name`, or `name (2)`, `name (3)`… — whichever isn't taken yet. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} (${i})`)) return `${name} (${i})`;
}
