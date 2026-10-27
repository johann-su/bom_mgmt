// Label content taken from what a location holds: `{{attr:Thread}}` in a
// text prints the parts' "Thread" attribute, and a graphic bound to a
// picture attribute (`attr: "icon-1"` on the element) prints the icon it
// names — so a bin of countersunk hex screws shows the countersunk head and
// the hex drive, and a bin of JST crimps the JST face and the crimp, from
// one template.
//
// Only what every part in the location agrees on is used: a bin of M3×8,
// M3×10 and M3×12 screws prints "M3" for {{attr:Thread}} but nothing for
// {{attr:Length}}. A location's own slot values (label-slots.ts) still win.
// Contents are the parts with a stock row directly in the location, empty
// ones included (that's where a refill goes); child locations don't count.

import type { GraphicElement, LabelElement, LabelTemplate } from "@/lib/label-template";
import type { LabelSlots } from "@/lib/label-slots";
import { iconAttributeKey, type PartAttribute } from "@/lib/part-attributes";

export type ContentIcon = Pick<GraphicElement, "markup" | "viewBox"> & { name: string };

/** What the contents agree on, keyed by lower-case attribute name. */
export type LabelContents = {
  attributes: Record<string, string>;
  // The agreed attributes whose value is a catalogue icon id, drawn.
  icons: Record<string, ContentIcon>;
};

export const NO_CONTENTS: LabelContents = { attributes: {}, icons: {} };

/** One part in a location. */
export type ContentPart = { attributes: PartAttribute[] };

/** Picture attributes offered when binding a graphic; any attribute holding an icon id works. */
export const PICTURED_ATTRIBUTES = [1, 2, 3].map(iconAttributeKey);

/** Attributes offered as `{{attr:…}}` chips; any attribute name works. */
export const COMMON_ATTRIBUTES = ["Short name", "Thread", "Material"];

const keyOf = (name: string) => name.trim().toLowerCase();

/** Values every part has, and has the same of; nothing for no parts. */
function agreed(maps: Map<string, string>[]): Map<string, string> {
  const [first, ...rest] = maps;
  if (!first) return new Map();
  return new Map([...first].filter(([key, value]) => rest.every((m) => m.get(key) === value)));
}

/**
 * Reduces a location's parts to what its label can show. `icon` looks a
 * catalogue id up: agreed values it finds are also drawable icons.
 */
export function labelContents(
  parts: ContentPart[],
  icon: (id: string) => ContentIcon | undefined,
): LabelContents {
  const attributes = agreed(
    parts.map(
      (p) =>
        new Map(
          p.attributes.filter((a) => a.key.trim() && a.value.trim()).map((a) => [keyOf(a.key), a.value.trim()]),
        ),
    ),
  );
  const icons: Record<string, ContentIcon> = {};
  for (const [key, value] of attributes) {
    const found = icon(value);
    if (found) icons[key] = found;
  }
  return { attributes: Object.fromEntries(attributes), icons };
}

const ATTR_RE = /\{\{\s*attr\s*:\s*([^{}]*?)\s*\}\}/gi;

/** Replaces `{{attr:Name}}` placeholders; attributes the contents don't agree on become empty. */
export function fillAttributes(text: string, contents: LabelContents): string {
  return text.replace(ATTR_RE, (_, name: string) => contents.attributes[keyOf(name)] ?? "");
}

/**
 * The template with the contents filled in. Run it after applySlots, with
 * the same slots: a graphic the location set its own value for keeps it.
 * A bound graphic the contents have no icon for is left off — a nut has no
 * drive — unless `keepStandIns` (the designer, where it must stay visible to
 * be edited).
 */
export function applyContents(
  template: LabelTemplate,
  contents: LabelContents,
  slots: LabelSlots | undefined,
  { keepStandIns = false } = {},
): LabelTemplate {
  const elements = template.elements.flatMap((el): LabelElement[] => {
    if (el.kind === "text" || el.kind === "code") return [{ ...el, text: fillAttributes(el.text, contents) }];
    if (el.kind !== "graphic" || !el.attr || (el.slot && slots?.[el.slot])) return [el];
    const found = contents.icons[keyOf(el.attr)];
    if (found) return [{ ...el, markup: found.markup, viewBox: found.viewBox, name: found.name }];
    return keepStandIns ? [el] : [];
  });
  return { ...template, elements };
}

// The designer's and template list's stand-in, matching SAMPLE_VARIABLES.
export const SAMPLE_CONTENTS: LabelContents = {
  attributes: { "short name": "M3×5.7", thread: "M3", length: "5.7 mm", material: "Brass" },
  icons: {},
};
