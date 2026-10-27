// Generic wire-to-board connectors for the "Generic part" wizard: JST series
// (with their real part numbers, which clones are sold under too), Dupont and
// pin headers. A series + piece + pin count pins the part down, so name,
// designation, ratings and what it mates with are derived here. Pure; see
// src/lib/generic-parts.ts for the interface.

import {
  parseCount,
  type GeneratedPart,
  type GenericFamily,
  type GenericParam,
  type GenericType,
} from "@/lib/generic-parts";
import type { PartAttribute } from "@/lib/part-attributes";

// The pieces JST makes. Their XH/PH/… systems are wire-to-board: the cable
// housing takes female contacts and the board header supplies the pins.
type GenuinePiece = "housing" | "header" | "header-ra" | "crimp";
// Pieces only clones make: male pins and a plug housing for them, to join two
// cables (kits sold as "JST XH male/female"). They have no JST number.
type ClonePiece = "plug" | "crimp-m";
type JstPiece = GenuinePiece | ClonePiece;

type JstSeries = {
  id: string;
  name: string; // "XH"
  pitch: number; // mm
  minPins: number;
  maxPins: number;
  current: string; // rated, per contact
  voltage: string;
  wire: string; // what the crimp contact takes
  smd: boolean; // headers are surface-mount (SH, GH)
  /** JST part numbers by piece, for a pin count (the crimp ignores it). */
  mpn: Record<GenuinePiece, (pins: number) => string>;
};

// Two-digit pin counts in the SH/GH numbering: SHR-04V-S-B, BM04B-SRSS-TB.
const pad = (n: number) => String(n).padStart(2, "0");

const JST_SERIES: JstSeries[] = [
  {
    id: "jst-xh",
    name: "XH",
    pitch: 2.5,
    minPins: 2,
    maxPins: 20,
    current: "3 A",
    voltage: "250 V",
    wire: "AWG 28–22",
    smd: false,
    mpn: {
      housing: (n) => `XHP-${n}`,
      header: (n) => `B${n}B-XH-A`,
      "header-ra": (n) => `S${n}B-XH-A`,
      crimp: () => "SXH-001T-P0.6",
    },
  },
  {
    id: "jst-ph",
    name: "PH",
    pitch: 2,
    minPins: 2,
    maxPins: 16,
    current: "2 A",
    voltage: "100 V",
    wire: "AWG 30–24",
    smd: false,
    mpn: {
      housing: (n) => `PHR-${n}`,
      header: (n) => `B${n}B-PH-K-S`,
      "header-ra": (n) => `S${n}B-PH-K-S`,
      crimp: () => "SPH-002T-P0.5S",
    },
  },
  {
    id: "jst-zh",
    name: "ZH",
    pitch: 1.5,
    minPins: 2,
    maxPins: 13,
    current: "1 A",
    voltage: "50 V",
    wire: "AWG 32–28",
    smd: false,
    mpn: {
      housing: (n) => `ZHR-${n}`,
      header: (n) => `B${n}B-ZR`,
      "header-ra": (n) => `S${n}B-ZR`,
      crimp: () => "SZH-002T-P0.5",
    },
  },
  {
    id: "jst-gh",
    name: "GH",
    pitch: 1.25,
    minPins: 2,
    maxPins: 15,
    current: "1 A",
    voltage: "50 V",
    wire: "AWG 30–26",
    smd: true,
    mpn: {
      housing: (n) => `GHR-${pad(n)}V-S`,
      header: (n) => `BM${pad(n)}B-GHS-TBT`,
      "header-ra": (n) => `SM${pad(n)}B-GHS-TB`,
      crimp: () => "SSHL-002T-P0.2",
    },
  },
  {
    id: "jst-sh",
    name: "SH",
    pitch: 1,
    minPins: 2,
    maxPins: 15,
    current: "1 A",
    voltage: "50 V",
    wire: "AWG 32–28",
    smd: true,
    mpn: {
      housing: (n) => `SHR-${pad(n)}V-S-B`,
      header: (n) => `BM${pad(n)}B-SRSS-TB`,
      "header-ra": (n) => `SM${pad(n)}B-SRSS-TB`,
      crimp: () => "SSH-003T-P0.2-H",
    },
  },
  {
    id: "jst-vh",
    name: "VH",
    pitch: 3.96,
    minPins: 2,
    maxPins: 11,
    current: "10 A",
    voltage: "250 V",
    wire: "AWG 22–16",
    smd: false,
    mpn: {
      housing: (n) => `VHR-${n}N`,
      header: (n) => `B${n}P-VH`,
      "header-ra": (n) => `B${n}PS-VH`,
      crimp: () => "SVH-21T-P1.1",
    },
  },
];

const PIN_CHIPS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 40];

const mm = (n: number) => `${n} mm`;
const attrs = (entries: [string, string | false | undefined][]): PartAttribute[] =>
  entries.flatMap(([key, value]) => (value ? [{ key, value }] : []));

function pinsParam(min: number, max: number, label = "Pins"): GenericParam {
  return {
    kind: "range",
    id: "pins",
    label,
    options: PIN_CHIPS.filter((n) => n >= min && n <= max).map(String),
    parse: (raw) => parseCount(raw, min, max),
    placeholder: `Other (${min}–${max})`,
  };
}

const MAKE_PARAM: GenericParam = {
  kind: "select",
  id: "make",
  label: "Make",
  options: [
    { value: "generic", label: "Generic (JST-compatible)" },
    { value: "jst", label: "JST (genuine)" },
  ],
};

const JST_PIECES: { value: GenuinePiece; label: string }[] = [
  { value: "housing", label: "Housing (cable side)" },
  { value: "header", label: "Header, top entry" },
  { value: "header-ra", label: "Header, side entry" },
  { value: "crimp", label: "Crimp contact, female" },
];
const CLONE_PIECES: { value: ClonePiece; label: string }[] = [
  { value: "plug", label: "Plug housing, male (wire-to-wire)" },
  { value: "crimp-m", label: "Crimp contact, male (wire-to-wire)" },
];
const isCrimp = (piece: string) => piece === "crimp" || piece === "crimp-m";

function jstType(series: JstSeries): GenericType {
  const label = `JST ${series.name}`;
  return {
    id: series.id,
    label,
    detail: `${series.pitch} mm`,
    title: `${label} wire-to-board connector, ${series.pitch} mm pitch`,
    icon: `connector/faces/${series.id}`,
    params: (values) => [
      {
        kind: "select",
        id: "piece",
        label: "Piece",
        // Genuine JST has no male crimps or plug housings.
        options: values.make === "jst" ? JST_PIECES : [...JST_PIECES, ...CLONE_PIECES],
      },
      MAKE_PARAM,
      ...(isCrimp(values.piece) ? [] : [pinsParam(series.minPins, series.maxPins)]),
    ],
    generate: (values) => generateJst(series, values.piece as JstPiece, values.make, values.pins),
  };
}

function generateJst(series: JstSeries, piece: JstPiece, make: string, rawPins: string | undefined): GeneratedPart | { error: string } {
  const clone = CLONE_PIECES.some((p) => p.value === piece);
  if (!clone && !JST_PIECES.some((p) => p.value === piece)) return { error: "Pick a piece" };
  const genuine = make === "jst";
  if (clone && genuine) return { error: "JST doesn't make that piece — pick Generic" };
  const pins = isCrimp(piece) ? 0 : Number(parseCount(rawPins ?? "", series.minPins, series.maxPins));
  if (!isCrimp(piece) && !pins) return { error: `Pick a pin count (${series.minPins}–${series.maxPins})` };
  const label = `JST ${series.name}`;
  const mpn = clone ? "" : series.mpn[piece as GenuinePiece](pins);
  const mount = series.smd ? "SMD" : "Through-hole";
  const headers = `${series.mpn.header(pins)} / ${series.mpn["header-ra"](pins)}`;
  const intro = `${label}-series wire-to-board`;
  const compat = genuine ? mpn : `${mpn}-compatible`;

  const byPiece = {
    housing: {
      name: `${label} housing ${pins}-pin`,
      description: `${intro} receptacle housing, ${pins} positions, ${series.pitch} mm pitch (${compat}). Mates with headers ${headers}; takes ${series.mpn.crimp(0)} crimp contacts.`,
      // The series' face shows the housing better than the generic top view.
      icon: `connector/faces/${series.id}`,
      extra: attrs([
        ["Mates with", headers],
        ["Contacts", series.mpn.crimp(0)],
        ["Wire", series.wire],
      ]),
    },
    header: {
      name: `${label} header ${pins}-pin, top entry`,
      description: `${intro} header, ${pins} positions, ${series.pitch} mm pitch, top entry, ${mount.toLowerCase()} (${compat}). Mates with housing ${series.mpn.housing(pins)}.`,
      icon: series.smd ? "connector/variants/header-smd" : "connector/variants/header",
      extra: attrs([
        ["Mount", mount],
        ["Mates with", series.mpn.housing(pins)],
      ]),
    },
    "header-ra": {
      name: `${label} header ${pins}-pin, side entry`,
      description: `${intro} header, ${pins} positions, ${series.pitch} mm pitch, side entry (right angle), ${mount.toLowerCase()} (${compat}). Mates with housing ${series.mpn.housing(pins)}.`,
      icon: "connector/variants/header-ra",
      extra: attrs([
        ["Mount", mount],
        ["Mates with", series.mpn.housing(pins)],
      ]),
    },
    crimp: {
      name: `${label} crimp contact, female`,
      description: `${intro} crimp contact (socket) for ${label} housings, ${series.wire} (${compat}).`,
      icon: "connector/variants/crimp-f",
      extra: attrs([
        ["Contact", "Female (socket)"],
        ["Wire", series.wire],
      ]),
    },
    plug: {
      name: `${label} plug housing ${pins}-pin, male`,
      description: `${label}-compatible wire-to-wire plug housing for male crimp pins, ${pins} positions, ${series.pitch} mm pitch. Mates with a ${series.mpn.housing(pins)} housing fitted with ${series.mpn.crimp(0)} contacts. A clone part: JST's own ${label} has no wire-to-wire plug.`,
      icon: "connector/variants/housing-m",
      extra: attrs([
        ["Mates with", series.mpn.housing(pins)],
        ["Contacts", `${label} male crimp pins`],
        ["Wire", series.wire],
      ]),
    },
    "crimp-m": {
      name: `${label} crimp contact, male`,
      description: `${label}-compatible male crimp pin for wire-to-wire plug housings, ${series.wire}. A clone part: JST's own ${label} has no male crimp contact.`,
      icon: "connector/variants/crimp-m",
      extra: attrs([
        ["Contact", "Male (pin)"],
        ["Wire", series.wire],
      ]),
    },
  }[piece];

  return {
    name: byPiece.name,
    description: byPiece.description,
    // Clones are sold under JST's numbers; the number is what BOMs list, so a
    // generic part keeps it as its designation.
    manufacturer: genuine ? "JST" : "",
    mpn,
    unit: "pcs",
    category: ["Connectors"],
    icon: byPiece.icon,
    preview: [...new Set([`connector/faces/${series.id}`, byPiece.icon])],
    attributes: [
      ...attrs([
        ["Series", label],
        ["Pitch", mm(series.pitch)],
        ["Pins", !isCrimp(piece) && String(pins)],
        ["Rated current", series.current],
        ["Rated voltage", series.voltage],
      ]),
      ...byPiece.extra,
    ],
  };
}

// Dupont: no maker, no part numbers — the "designation" is the description.
const DUPONT: GenericType = {
  id: "dupont",
  label: "Dupont",
  detail: "2.54 mm",
  title: "Dupont-style crimp connector, 2.54 mm pitch",
  icon: "connector/faces/dupont",
  params: (values) => [
    {
      kind: "select",
      id: "piece",
      label: "Piece",
      options: [
        { value: "housing", label: "Housing" },
        { value: "crimp-f", label: "Crimp contact, female" },
        { value: "crimp-m", label: "Crimp contact, male" },
      ],
    },
    ...(values.piece === "housing"
      ? [
          {
            kind: "select" as const,
            id: "rows",
            label: "Rows",
            options: [
              { value: "1", label: "Single row" },
              { value: "2", label: "Dual row" },
            ],
          },
          pinsParam(1, 20, "Pins per row"),
        ]
      : []),
  ],
  generate: (values) => {
    const common = attrs([
      ["Series", "Dupont"],
      ["Pitch", "2.54 mm"],
    ]);
    if (values.piece === "crimp-f" || values.piece === "crimp-m") {
      const gender = values.piece === "crimp-f" ? "female" : "male";
      const icon = values.piece === "crimp-f" ? "connector/variants/crimp-f" : "connector/variants/crimp-m";
      return {
        name: `Dupont crimp contact, ${gender}`,
        description: `Dupont-style crimp contact, ${gender}, for 2.54 mm housings, AWG 28–22.`,
        manufacturer: "",
        mpn: "",
        unit: "pcs",
        category: ["Connectors"],
        icon,
        preview: ["connector/faces/dupont", icon],
        attributes: [...common, { key: "Contact", value: gender === "female" ? "Female (socket)" : "Male (pin)" }, { key: "Wire", value: "AWG 28–22" }],
      };
    }
    if (values.piece !== "housing") return { error: "Pick a piece" };
    const rows = values.rows === "2" ? 2 : 1;
    const perRow = Number(parseCount(values.pins ?? "", 1, 20));
    if (!perRow) return { error: "Pick a pin count (1–20)" };
    return {
      name: `Dupont housing ${rows}×${perRow}`,
      description: `Dupont-style crimp housing, ${rows} × ${perRow} positions, 2.54 mm pitch.`,
      manufacturer: "",
      mpn: "",
      unit: "pcs",
      category: ["Connectors"],
      icon: "connector/faces/dupont",
      preview: ["connector/faces/dupont"],
      attributes: [
        ...common,
        { key: "Rows", value: String(rows) },
        { key: "Pins", value: String(rows * perRow) },
      ],
    };
  },
};

const HEADER_PITCHES = ["2.54", "2", "1.27"];

const PIN_HEADER: GenericType = {
  id: "pin-header",
  label: "Pin header",
  detail: "1.27–2.54 mm",
  title: "Board-mount pin or socket header (breakaway strip)",
  icon: "connector/variants/header",
  params: () => [
    {
      kind: "select",
      id: "gender",
      label: "Gender",
      options: [
        { value: "male", label: "Male (pins)" },
        { value: "female", label: "Female (socket)" },
      ],
    },
    {
      kind: "select",
      id: "angle",
      label: "Orientation",
      options: [
        { value: "straight", label: "Straight" },
        { value: "right", label: "Right angle" },
      ],
    },
    {
      kind: "select",
      id: "rows",
      label: "Rows",
      options: [
        { value: "1", label: "Single row" },
        { value: "2", label: "Dual row" },
      ],
    },
    {
      kind: "select",
      id: "pitch",
      label: "Pitch",
      options: HEADER_PITCHES.map((p) => ({ value: p, label: `${p} mm` })),
    },
    pinsParam(1, 40, "Pins per row"),
  ],
  generate: (values) => {
    if (!HEADER_PITCHES.includes(values.pitch)) return { error: "Pick a pitch" };
    const perRow = Number(parseCount(values.pins ?? "", 1, 40));
    if (!perRow) return { error: "Pick a pin count (1–40)" };
    const rows = values.rows === "2" ? 2 : 1;
    const female = values.gender === "female";
    const right = values.angle === "right";
    const kind = female ? "Female header" : "Pin header";
    const icon = female ? "connector/variants/socket" : right ? "connector/variants/header-ra" : "connector/variants/header";
    return {
      name: `${kind} ${rows}×${perRow}, ${values.pitch} mm${right ? ", right angle" : ""}`,
      description: `${female ? "Female socket" : "Male pin"} header, ${rows} × ${perRow} positions, ${values.pitch} mm pitch, ${right ? "right angle" : "straight"}, through-hole.`,
      manufacturer: "",
      mpn: "",
      unit: "pcs",
      category: ["Connectors"],
      icon,
      preview: [icon],
      attributes: attrs([
        ["Pitch", `${values.pitch} mm`],
        ["Rows", String(rows)],
        ["Pins", String(rows * perRow)],
        ["Gender", female ? "Female" : "Male"],
        ["Orientation", right ? "Right angle" : "Straight"],
        ["Mount", "Through-hole"],
      ]),
    };
  },
};

export const CONNECTOR_FAMILY: GenericFamily = {
  id: "connectors",
  label: "Connectors",
  description: "Fills in the name, the JST part number where there is one, pitch, ratings and mating parts.",
  types: [...JST_SERIES.map(jstType), DUPONT, PIN_HEADER],
};
