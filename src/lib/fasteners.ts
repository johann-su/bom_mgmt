// Generates generic fastener parts (screws, nuts, washers, inserts) from the
// ISO/DIN standards, for the "Generic part" wizard. There is no free fastener
// catalog to search, but a standard + size + length + material pins a
// fastener down completely, so the name, description, designation and specs
// are derived here instead of looked up. Dimensions are the standards' nominal
// (max) values in mm. Pure; FASTENER_FAMILY at the bottom plugs it into the
// wizard (src/lib/generic-parts.ts).

import type { GeneratedPart, GenericFamily, GenericParam } from "@/lib/generic-parts";
import type { PartAttribute } from "@/lib/part-attributes";

type Kind = "screw" | "setscrew" | "nut" | "washer" | "insert";

// Coarse metric thread pitch (ISO 261), which every standard here uses.
const PITCH: Record<string, number> = {
  M2: 0.4,
  "M2.5": 0.45,
  M3: 0.5,
  M4: 0.7,
  M5: 0.8,
  M6: 1,
  M8: 1.25,
  M10: 1.5,
  M12: 1.75,
};

/**
 * Per-size dimensions. Screws: [head Ø, head height, drive size];
 * hex-head screws and nuts: [width across flats, head/nut height];
 * set screws: [hex key]; washers: [inner Ø, outer Ø, thickness];
 * inserts: [] (they vary by maker).
 */
type Dims = Record<string, number[]>;

export type FastenerType = {
  id: string;
  label: string; // goes into the part name: "Socket head cap screw M3×8 A2-70"
  /** The full designation for the description: "Hexagon socket head cap screw". */
  title: string;
  standard: string; // "" for un-standardized parts (heat-set inserts)
  alias: string; // the older DIN number people still search for, or ""
  kind: Kind;
  category: string; // suggested category; "Fasteners" is offered as its parent
  drive?: string; // "Hex socket", "Torx"; the dims hold its size
  dims: Dims;
  /** Common lengths, for the length chips; any length can still be typed. */
  lengths?: number[];
  /** Label-icon catalogue ids (src/lib/label-icons.json) that picture it: the
   *  part itself, then its drive if it has one — as on a bin label. */
  icons: string[];
};

const SCREW_LENGTHS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120];
const SET_SCREW_LENGTHS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30];
const INSERT_LENGTHS = [3, 4, 5, 5.7, 6, 8, 10, 12];

const SET_SCREW_KEYS: Dims = {
  M2: [0.9],
  "M2.5": [1.3],
  M3: [1.5],
  M4: [2],
  M5: [2.5],
  M6: [3],
  M8: [4],
  M10: [5],
  M12: [6],
};

export const FASTENER_TYPES: FastenerType[] = [
  {
    id: "iso4762",
    icons: ["screw/heads-sideways/machine/socket-cap", "screw/drives/hex"],
    label: "Socket head cap screw",
    title: "Hexagon socket head cap screw",
    standard: "ISO 4762",
    alias: "DIN 912",
    kind: "screw",
    category: "Screws",
    drive: "Hex socket",
    dims: {
      M2: [3.8, 2, 1.5],
      "M2.5": [4.5, 2.5, 2],
      M3: [5.5, 3, 2.5],
      M4: [7, 4, 3],
      M5: [8.5, 5, 4],
      M6: [10, 6, 5],
      M8: [13, 8, 6],
      M10: [16, 10, 8],
      M12: [18, 12, 10],
    },
    lengths: SCREW_LENGTHS,
  },
  {
    id: "iso7380",
    icons: ["screw/heads-sideways/machine/button", "screw/drives/hex"],
    label: "Button head screw",
    title: "Hexagon socket button head screw",
    standard: "ISO 7380-1",
    alias: "",
    kind: "screw",
    category: "Screws",
    drive: "Hex socket",
    dims: {
      M3: [5.7, 1.65, 2],
      M4: [7.6, 2.2, 2.5],
      M5: [9.5, 2.75, 3],
      M6: [10.5, 3.3, 4],
      M8: [14, 4.4, 5],
      M10: [17.5, 5.5, 6],
      M12: [21, 6.6, 8],
    },
    lengths: SCREW_LENGTHS,
  },
  {
    id: "iso10642",
    icons: ["screw/heads-sideways/machine/countersunk", "screw/drives/hex"],
    label: "Countersunk screw",
    title: "Hexagon socket countersunk head screw",
    standard: "ISO 10642",
    alias: "DIN 7991",
    kind: "screw",
    category: "Screws",
    drive: "Hex socket",
    dims: {
      M3: [6.72, 1.86, 2],
      M4: [8.96, 2.48, 2.5],
      M5: [11.2, 3.1, 3],
      M6: [13.44, 3.72, 4],
      M8: [17.92, 4.96, 5],
      M10: [22.4, 6.2, 6],
      M12: [26.88, 7.44, 8],
    },
    lengths: SCREW_LENGTHS,
  },
  {
    id: "iso4017",
    icons: ["screw/heads-sideways/machine/hex-head", "screw/drives/ext-hex"],
    label: "Hex head screw",
    title: "Hexagon head screw, fully threaded",
    standard: "ISO 4017",
    alias: "DIN 933",
    kind: "screw",
    category: "Screws",
    dims: {
      M3: [5.5, 2],
      M4: [7, 2.8],
      M5: [8, 3.5],
      M6: [10, 4],
      M8: [13, 5.3],
      M10: [16, 6.4],
      M12: [18, 7.5],
    },
    lengths: SCREW_LENGTHS,
  },
  {
    id: "iso4026",
    icons: ["screw/heads-sideways/machine/set", "screw/drives/hex"],
    label: "Set screw, flat point",
    title: "Hexagon socket set screw with flat point",
    standard: "ISO 4026",
    alias: "DIN 913",
    kind: "setscrew",
    category: "Screws",
    drive: "Hex socket",
    dims: SET_SCREW_KEYS,
    lengths: SET_SCREW_LENGTHS,
  },
  {
    id: "iso4029",
    icons: ["screw/heads-sideways/machine/set", "screw/drives/hex"],
    label: "Set screw, cup point",
    title: "Hexagon socket set screw with cup point",
    standard: "ISO 4029",
    alias: "DIN 916",
    kind: "setscrew",
    category: "Screws",
    drive: "Hex socket",
    dims: SET_SCREW_KEYS,
    lengths: SET_SCREW_LENGTHS,
  },
  {
    id: "iso4032",
    icons: ["screw/hardware/nuts/hex-nut"],
    label: "Hex nut",
    title: "Hexagon nut",
    standard: "ISO 4032",
    alias: "DIN 934",
    kind: "nut",
    category: "Nuts",
    dims: {
      M2: [4, 1.6],
      "M2.5": [5, 2],
      M3: [5.5, 2.4],
      M4: [7, 3.2],
      M5: [8, 4.7],
      M6: [10, 5.2],
      M8: [13, 6.8],
      M10: [16, 8.4],
      M12: [18, 10.8],
    },
  },
  {
    id: "din985",
    icons: ["screw/hardware/nuts/nyloc"],
    label: "Nyloc nut",
    title: "Prevailing torque hexagon nut with nylon insert",
    standard: "DIN 985",
    alias: "",
    kind: "nut",
    category: "Nuts",
    dims: {
      M3: [5.5, 4],
      M4: [7, 5],
      M5: [8, 5],
      M6: [10, 6],
      M8: [13, 8],
      M10: [17, 10],
      M12: [19, 12],
    },
  },
  {
    id: "iso7089",
    icons: ["screw/hardware/washers/washer"],
    label: "Washer",
    title: "Plain washer, normal series",
    standard: "ISO 7089",
    alias: "DIN 125-A",
    kind: "washer",
    category: "Washers",
    dims: {
      M2: [2.2, 5, 0.3],
      "M2.5": [2.7, 6, 0.5],
      M3: [3.2, 7, 0.5],
      M4: [4.3, 9, 0.8],
      M5: [5.3, 10, 1],
      M6: [6.4, 12, 1.6],
      M8: [8.4, 16, 1.6],
      M10: [10.5, 20, 2],
      M12: [13, 24, 2.5],
    },
  },
  {
    id: "iso7093",
    icons: ["screw/hardware/washers/fender"],
    label: "Large washer",
    title: "Plain washer, large series",
    standard: "ISO 7093-1",
    alias: "DIN 9021",
    kind: "washer",
    category: "Washers",
    dims: {
      M3: [3.2, 9, 0.8],
      M4: [4.3, 12, 1],
      M5: [5.3, 15, 1.2],
      M6: [6.4, 18, 1.6],
      M8: [8.4, 24, 2],
      M10: [10.5, 30, 2.5],
      M12: [13, 37, 3],
    },
  },
  {
    id: "heatset",
    icons: ["screw/hardware/inserts/heat-insert"],
    label: "Heat-set insert",
    title: "Threaded heat-set insert for plastics",
    standard: "",
    alias: "",
    kind: "insert",
    category: "Threaded inserts",
    dims: { M2: [], "M2.5": [], M3: [], M4: [], M5: [], M6: [], M8: [] },
    lengths: INSERT_LENGTHS,
  },
];

export type FastenerMaterial = {
  id: string;
  label: string;
  /** The designation per kind ("A2-70" on a screw, "A2" on a washer); a
   *  missing kind means the material isn't offered for it. */
  grade: Partial<Record<Kind, string>>;
};

// Steel screws carry their property class as sold (8.8 zinc, 12.9 black
// oxide); for nuts, washers and set screws only the finish tells them apart.
export const FASTENER_MATERIALS: FastenerMaterial[] = [
  {
    id: "a2",
    label: "Stainless steel A2",
    grade: { screw: "A2-70", setscrew: "A2", nut: "A2-70", washer: "A2" },
  },
  {
    id: "a4",
    label: "Stainless steel A4",
    grade: { screw: "A4-70", setscrew: "A4", nut: "A4-70", washer: "A4" },
  },
  {
    id: "zinc",
    label: "Steel, zinc plated",
    grade: { screw: "8.8 zinc", setscrew: "zinc", nut: "zinc", washer: "zinc" },
  },
  {
    id: "black",
    label: "Steel, black oxide",
    grade: { screw: "12.9 black", setscrew: "black", nut: "black", washer: "black" },
  },
  {
    id: "brass",
    label: "Brass",
    grade: { screw: "brass", nut: "brass", washer: "brass", insert: "brass" },
  },
  {
    id: "nylon",
    label: "Nylon",
    grade: { screw: "PA66", nut: "PA66", washer: "PA66" },
  },
];

export type FastenerSpec = {
  type: string; // FastenerType id
  size: string; // "M3"
  material: string; // FastenerMaterial id
  length?: number; // mm; required for screws and inserts, ignored otherwise
};

export function fastenerType(id: string): FastenerType | undefined {
  return FASTENER_TYPES.find((t) => t.id === id);
}

export function fastenerSizes(type: FastenerType): string[] {
  return Object.keys(type.dims);
}

export function materialsFor(type: FastenerType): FastenerMaterial[] {
  return FASTENER_MATERIALS.filter((m) => m.grade[type.kind]);
}

export function hasLength(type: FastenerType): boolean {
  return type.kind === "screw" || type.kind === "setscrew" || type.kind === "insert";
}

/**
 * The common lengths worth offering for a size: screws from about the
 * thread's diameter up to 12× it, set screws up to 5×, inserts up to 4×.
 */
export function commonLengths(type: FastenerType, size: string): number[] {
  const d = diameter(size);
  if (!type.lengths || !d) return [];
  const max = type.kind === "screw" ? 12 * d : type.kind === "setscrew" ? 5 * d : 4 * d;
  const min = type.kind === "screw" ? Math.max(d, 3) : d / 2;
  return type.lengths.filter((l) => l >= min && l <= max);
}

/**
 * A typed length in mm, or null if it isn't one: "8", "5.7", "5,7" (decimal
 * comma) and "8 mm" are accepted, up to 500 mm with at most two decimals.
 */
export function parseLength(raw: string): number | null {
  const match = raw.trim().replace(",", ".").match(/^(\d+(?:\.\d{1,2})?)\s*(?:mm)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 && value <= 500 ? value : null;
}

const mm = (n: number) => `${n} mm`;
// "Stainless steel A2 (A2-70)", or just "Brass" when the grade adds nothing.
const materialText = (m: FastenerMaterial, grade: string) =>
  grade.toLowerCase() === m.label.toLowerCase() ? m.label : `${m.label} (${grade})`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const diameter = (size: string) => Number(size.slice(1)) || 0;

/** Describes one fastener, or says which part of the spec doesn't exist. */
export function generateFastener(spec: FastenerSpec): GeneratedPart | { error: string } {
  const type = fastenerType(spec.type);
  if (!type) return { error: "Unknown fastener type" };
  const dims = type.dims[spec.size];
  if (!dims) return { error: `${type.label} isn't standardized in ${spec.size}` };
  const material = FASTENER_MATERIALS.find((m) => m.id === spec.material);
  const grade = material?.grade[type.kind];
  if (!material || !grade) return { error: `${type.label} isn't offered in that material` };
  const length = hasLength(type) ? spec.length : undefined;
  if (hasLength(type) && !(length && length > 0 && length <= 500)) {
    return { error: "Enter a length" };
  }

  const size = length ? `${spec.size}×${length}` : spec.size;
  // The designation, ASCII so it's easy to type into a search or BOM.
  const designation = [type.standard, length ? `${spec.size}x${length}` : spec.size, grade]
    .filter(Boolean)
    .join(" ");
  const standardText = type.standard
    ? ` to ${type.standard}${type.alias ? ` (${type.alias})` : ""}`
    : "";
  const sizeText = length ? `${spec.size} × ${length} mm` : spec.size;

  return {
    name: `${type.label} ${size} ${grade}`,
    description: `${type.title}${standardText}, ${sizeText}, ${lowerFirst(materialText(material, grade))}.`,
    // Un-standardized parts have no designation to match a BOM on.
    mpn: type.standard ? designation : "",
    manufacturer: "",
    unit: "pcs",
    category: ["Fasteners", type.category],
    icon: type.icons[0],
    // Drive first, then the side view — as on a bin label.
    preview: [...type.icons].reverse(),
    attributes: attributesFor(type, spec.size, dims, length, material, grade),
  };
}

function attributesFor(
  type: FastenerType,
  size: string,
  dims: number[],
  length: number | undefined,
  material: FastenerMaterial,
  grade: string,
): PartAttribute[] {
  const out: PartAttribute[] = [];
  const add = (key: string, value: string) => out.push({ key, value });
  if (type.standard) add("Standard", type.alias ? `${type.standard} / ${type.alias}` : type.standard);
  if (type.kind === "washer") {
    add("Fits", size);
    add("Inner Ø", mm(dims[0]));
    add("Outer Ø", mm(dims[1]));
    add("Thickness", mm(dims[2]));
  } else {
    add("Thread", size);
    add("Pitch", mm(PITCH[size]));
  }
  if (length) add("Length", mm(length));
  if (type.kind === "screw" && type.drive) {
    add("Head Ø", mm(dims[0]));
    add("Head height", mm(dims[1]));
    add("Drive", `${type.drive} ${mm(dims[2])}`);
  } else if (type.kind === "screw" || type.kind === "nut") {
    add("Width across flats", mm(dims[0]));
    add(type.kind === "nut" ? "Height" : "Head height", mm(dims[1]));
  } else if (type.kind === "setscrew") {
    add("Drive", `${type.drive} ${mm(dims[0])}`);
  }
  add("Material", materialText(material, grade));
  return out;
}

export const FASTENER_FAMILY: GenericFamily = {
  id: "fasteners",
  label: "Fasteners",
  description: "Fills in the name, ISO/DIN designation and dimensions.",
  types: FASTENER_TYPES.map((type) => ({
    id: type.id,
    label: type.label,
    detail: type.standard || "no standard",
    title: [type.title, type.standard && `${type.standard}${type.alias ? ` / ${type.alias}` : ""}`]
      .filter(Boolean)
      .join("\n"),
    icon: type.icons[0],
    params: (values) => {
      const params: GenericParam[] = [
        {
          kind: "select",
          id: "size",
          label: "Size",
          options: fastenerSizes(type).map((size) => ({ value: size, label: size })),
          default: "M3",
        },
        {
          kind: "select",
          id: "material",
          label: "Material",
          options: materialsFor(type).map((m) => ({ value: m.id, label: m.label })),
        },
      ];
      if (hasLength(type)) {
        params.push({
          kind: "range",
          id: "length",
          label: "Length (mm)",
          options: commonLengths(type, values.size ?? "").map(String),
          parse: (raw) => {
            const length = parseLength(raw);
            return length === null ? null : String(length);
          },
          placeholder: "Other length",
        });
      }
      return params;
    },
    generate: (values) =>
      generateFastener({
        type: type.id,
        size: values.size,
        material: values.material,
        length: values.length ? Number(values.length) : undefined,
      }),
  })),
};
