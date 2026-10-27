// Per-location label content. A template marks some text or graphic elements
// as named slots (`slot` on the element, see label-template.ts); a location
// stores values for them in `locations.label_slots`. Rendering applies the
// values to a copy of the template, so the layout, size and style stay the
// template's — editing the Bin template still reaches every bin — while one
// bin prints a screw-head symbol and another a washer.
//
// Values are keyed by slot name, not element id: a type switched to another
// template that has a slot of the same name keeps the bin's symbol. Values
// for slots the template doesn't have are kept but ignored.

import {
  SLOT_NAME_RE,
  type GraphicElement,
  type LabelElement,
  type LabelTemplate,
  type LabelVariables,
  type TextElement,
} from "@/lib/label-template";
import type { LabelContents } from "@/lib/label-contents";
import { MAX_GRAPHIC_MARKUP, sanitizeSvgMarkup } from "@/lib/svg-sanitize";

export type SlotValue =
  // Replaces the text (which may use {{variables}} like any label text).
  | { kind: "text"; text: string }
  // Replaces the drawing; the element's box and "keep proportions" stay.
  | { kind: "graphic"; markup: string; viewBox: GraphicElement["viewBox"]; name?: string }
  // Leaves the element off this location's label.
  | { kind: "none" };

export type LabelSlots = Record<string, SlotValue>;

/** What one label is printed with: the location's variables, slot values and contents. */
export type LabelData = { vars: Partial<LabelVariables>; slots?: LabelSlots; contents?: LabelContents };

// `element` is the first element with this name — its content is the default.
export type TemplateSlot =
  | { name: string; kind: "text"; element: TextElement }
  | { name: string; kind: "graphic"; element: GraphicElement };

type SlottedElement = TextElement | GraphicElement;
const slotted = (el: LabelElement): el is SlottedElement =>
  (el.kind === "text" || el.kind === "graphic") && !!el.slot;

/** The slots a template offers, once per name, in element order. */
export function templateSlots(template: LabelTemplate): TemplateSlot[] {
  const slots = new Map<string, TemplateSlot>();
  for (const el of template.elements) {
    if (!slotted(el) || slots.has(el.slot!)) continue;
    const name = el.slot!;
    slots.set(name, el.kind === "text" ? { name, kind: "text", element: el } : { name, kind: "graphic", element: el });
  }
  return [...slots.values()];
}

/** Slot names used by both a text and a graphic — a location's value can only fit one of them. */
export function slotConflicts(template: LabelTemplate): string[] {
  const kinds = new Map<string, Set<string>>();
  for (const el of template.elements) {
    if (slotted(el)) kinds.set(el.slot!, (kinds.get(el.slot!) ?? new Set()).add(el.kind));
  }
  return [...kinds].filter(([, k]) => k.size > 1).map(([name]) => name);
}

/**
 * A slot name not used in the template yet: `base`, `base-2`, … Sharing a
 * name is how two elements show the same value, so a new slot shouldn't
 * share one by accident.
 */
export function freeSlotName(template: LabelTemplate, base: string): string {
  const used = new Set(template.elements.filter(slotted).map((el) => el.slot));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * The template with this location's slot values filled in. Elements sharing
 * a slot name all take the value; a value whose kind doesn't match the
 * element (the template changed a text slot to a graphic) is ignored, so the
 * element shows its default rather than nothing.
 */
export function applySlots(template: LabelTemplate, slots: LabelSlots | undefined): LabelTemplate {
  if (!slots || !template.elements.some(slotted)) return template;
  const elements = template.elements.flatMap((el): LabelElement[] => {
    if (!slotted(el)) return [el];
    const value = slots[el.slot!];
    if (!value) return [el];
    if (value.kind === "none") return [];
    if (value.kind === "text" && el.kind === "text") return [{ ...el, text: value.text }];
    if (value.kind === "graphic" && el.kind === "graphic") {
      const { markup, viewBox, name } = value;
      return [{ ...el, markup, viewBox, ...(name ? { name } : {}) }];
    }
    return [el];
  });
  return { ...template, elements };
}

// --- Validation ---

const MAX_SLOTS = 20;
const MAX_TEXT = 500;
const MAX_MARKUP_TOTAL = 600_000;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6;
}

/** Checks one untrusted slot value, re-sanitising any graphic. */
export function parseSlotValue(input: unknown): SlotValue | { error: string } {
  const v = (input ?? {}) as Record<string, unknown>;
  if (v.kind === "none") return { kind: "none" };
  if (v.kind === "text") {
    if (typeof v.text !== "string") return { error: "Slot text must be a string" };
    return { kind: "text", text: v.text.slice(0, MAX_TEXT) };
  }
  if (v.kind === "graphic") {
    const markup =
      typeof v.markup === "string" && v.markup.length <= MAX_GRAPHIC_MARKUP ? sanitizeSvgMarkup(v.markup) : null;
    const vb = Array.isArray(v.viewBox) ? v.viewBox : [];
    if (!markup || vb.length !== 4 || !vb.every(finite) || vb[2] <= 0 || vb[3] <= 0) {
      return { error: "Invalid graphic" };
    }
    const name = typeof v.name === "string" ? v.name.slice(0, 100) : "";
    return { kind: "graphic", markup, viewBox: vb as GraphicElement["viewBox"], ...(name ? { name } : {}) };
  }
  return { error: "Unknown slot kind" };
}

/**
 * Checks untrusted slot values (a stored row, a form submission). Invalid
 * entries are an error, not silently dropped — a bin quietly losing its
 * symbol is worse than a refused save.
 */
export function parseSlots(input: unknown): LabelSlots | { error: string } {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) return { error: "Slots must be an object" };
  const entries = Object.entries(input);
  if (entries.length > MAX_SLOTS) return { error: `At most ${MAX_SLOTS} slots` };
  const slots: LabelSlots = {};
  let markupBytes = 0;
  for (const [name, raw] of entries) {
    if (!SLOT_NAME_RE.test(name)) return { error: `Invalid slot name "${name.slice(0, 40)}"` };
    const value = parseSlotValue(raw);
    if ("error" in value) return { error: `Slot ${name}: ${value.error}` };
    if (value.kind === "graphic") markupBytes += value.markup.length;
    slots[name] = value;
  }
  if (markupBytes > MAX_MARKUP_TOTAL) return { error: "The graphics on this label are too large in total" };
  return slots;
}

/** Reads a stored `label_slots` column, falling back to none if it's unusable. */
export function storedSlots(input: unknown): LabelSlots {
  const parsed = parseSlots(input);
  return "error" in parsed ? {} : parsed;
}

/** Sets (or with `null`, clears) one slot, keeping the others. */
export function withSlot(slots: LabelSlots, name: string, value: SlotValue | null): LabelSlots {
  const next = { ...slots };
  if (value) next[name] = value;
  else delete next[name];
  return next;
}
