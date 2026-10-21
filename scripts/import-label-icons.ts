// Builds the label designer's icon library (src/lib/label-icons.json) from
// the icon packs vendored in assets/icon-packs/<pack>/:
//
//   svg/…/<id>.svg   the drawings (48×48, currentColor)
//   pack.json        names, specs and notes for each id
//
// Rebuild after editing a pack:
//
//   npx tsx scripts/import-label-icons.ts
//
// To take in new versions of the "bin icon" packs (folders with svg/ and an
// HTML index page), vendor them first; this replaces the pack's svg/ and
// pack.json, then rebuilds:
//
//   npx tsx scripts/import-label-icons.ts --vendor ~/Downloads/component-icons \
//     ~/Downloads/connector-icons ~/Downloads/screw-icons ~/Downloads/motion-icons
//
// The metadata comes from the page's `const DATA = {…}` line via JSON.parse;
// the page itself is never run. Every SVG goes through importSvg, so the
// library holds exactly what a user upload would after sanitising. Only the
// generated JSON ships with the app; assets/ is just its source.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { importSvg } from "@/lib/svg-sanitize";
import type { LabelIcon } from "@/lib/label-icons";

const ROOT = join(import.meta.dirname, "..");
const PACKS_DIR = join(ROOT, "assets/icon-packs");
const OUT = join(ROOT, "src/lib/label-icons.json");
// Library order.
const PACK_ORDER = ["component", "connector", "screw", "motion"] as const;
type Pack = (typeof PACK_ORDER)[number];

type Item = Record<string, unknown> & { id: string; name: string; note?: string; short?: string };
type Data = Record<string, Item[]>;
type Entry = Omit<LabelIcon, "viewBox" | "markup"> & { file: string };

// --- Vendoring ---

/** The pack's DATA without the inline drawings (the SVG files have those). */
function stripMarkup(value: unknown): unknown {
  if (typeof value === "string") return value.includes("<") ? undefined : value;
  if (Array.isArray(value)) return value.map(stripMarkup);
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    // e.g. heads' { machine: "<path…>", wood: "<path…>" } → which threads exist.
    if (entries.length && entries.every(([, v]) => typeof v === "string" && v.includes("<"))) {
      return entries.map(([k]) => k);
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, stripMarkup(v)]).filter(([, v]) => v !== undefined));
  }
  return value;
}

function vendor(dir: string) {
  const pack = PACK_ORDER.find((p) => dir.replace(/\/$/, "").endsWith(`${p}-icons`));
  if (!pack) throw new Error(`Unknown pack ${dir} (expected …/<${PACK_ORDER.join("|")}>-icons)`);
  const html = readdirSync(dir).find((f) => f.endsWith(".html"));
  if (!html) throw new Error(`No index .html in ${dir}`);
  const line = readFileSync(join(dir, html), "utf8")
    .split("\n")
    .find((l) => l.startsWith("const DATA = "));
  if (!line) throw new Error(`No "const DATA = " line in ${html}`);
  const data = JSON.parse(line.slice("const DATA = ".length).replace(/;\s*$/, ""));

  const target = join(PACKS_DIR, pack);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "pack.json"), JSON.stringify(stripMarkup(data), null, 1) + "\n");
  // Only the SVGs — no PNG previews, no HTML.
  cpSync(join(dir, "svg"), join(target, "svg"), {
    recursive: true,
    filter: (src) => !/\/\.[^/]*$/.test(src) && (!/\.[a-z0-9]+$/i.test(src) || src.endsWith(".svg")),
  });
  console.log(`Vendored ${pack} from ${dir}`);
}

// --- Building ---

const label = (map: Record<string, string>, key: unknown, fallback: string) => map[String(key)] ?? fallback;
const keywords = (...words: unknown[]) => words.filter((w) => typeof w === "string" && w).join(" ");

/** Per pack: which file each icon comes from, and how it's named and filed. */
const RULES: Record<Pack, (data: Data) => Entry[]> = {
  component: (data) => [
    ...(data.symbols ?? []).map((i) => ({
      file: `symbols/${i.id}.svg`,
      category: label(
        { passive: "Components — passive", semi: "Components — semiconductors", em: "Components — electromechanical" },
        i.group,
        "Components",
      ),
      // The drawing standard where it matters (ANSI vs IEC resistor).
      detail: String(i.std ?? ""),
      ...common(i),
    })),
    ...(data.packages ?? []).map((i) => ({
      file: `packages/${i.id}.svg`,
      category: label(
        { tht: "Packages — through-hole", smd: "Packages — SMD", cell: "Cells & batteries" },
        i.group,
        "Packages",
      ),
      detail: String(i.code ?? ""),
      ...common(i),
    })),
  ],
  connector: (data) => [
    ...(data.families ?? []).map((i) => ({
      file: `faces/${i.id}.svg`,
      category: label(
        {
          signal: "Connectors — signal",
          power: "Connectors — power",
          usb: "Connectors — USB",
          rf: "Connectors — RF",
          data: "Connectors — data & audio",
          industrial: "Connectors — industrial",
          terminal: "Crimp terminals",
        },
        i.group,
        "Connectors",
      ),
      detail: String(i.spec ?? ""),
      ...common(i),
    })),
    ...(data.variants ?? []).map((i) => ({
      file: `variants/${i.id}.svg`,
      category: "Connector variants",
      detail: `${i.gender === "M" ? "Male" : "Female"} · ${String(i.view ?? "").toLowerCase()} view`,
      ...common(i),
    })),
  ],
  screw: (data) => {
    const threads = new Map((data.threads ?? []).map((t) => [t.id, t]));
    const threadCategory: Record<string, string> = {
      machine: "Screws — machine thread",
      tapping: "Screws — self-tapping",
      wood: "Screws — wood",
      plastic: "Screws — for plastic",
    };
    // Each head comes per thread type; the sideways drawing sits right after
    // the upright one, so both are found together.
    const heads = [...threads.keys()].flatMap((thread) =>
      (data.heads ?? []).flatMap((h) =>
        (["heads", "heads-sideways"] as const).map((dir) => {
          const t = threads.get(thread)!;
          return {
            file: `${dir}/${thread}/${h.id}.svg`,
            category: threadCategory[thread] ?? `Screws — ${t.name}`,
            ...common(h),
            name: dir === "heads-sideways" ? `${h.name} (sideways)` : h.name,
            // Machine screws are known by their head standard, the rest by thread type.
            detail: String(thread === "machine" ? (h.code ?? "") : (t.code ?? "")),
            keywords: keywords(h.short, t.short, t.name),
          };
        }),
      ),
    );
    return [
      ...(data.drives ?? []).map((i) => ({
        file: `drives/${i.id}.svg`,
        category: "Screw drives",
        detail: String(i.code ?? ""),
        ...common(i),
      })),
      ...heads,
      ...(data.hardware ?? []).map((i) => ({
        file: `hardware/${i.group}/${i.id}.svg`,
        category: label(
          {
            nuts: "Nuts",
            washers: "Washers",
            inserts: "Inserts, standoffs & rod",
            extrusion: "Extrusion nuts (T-slot)",
            pins: "Pins, rivets & clips",
          },
          i.group,
          "Hardware",
        ),
        detail: String(i.code ?? ""),
        ...common(i),
      })),
    ];
  },
  motion: (data) =>
    (data.parts ?? []).map((i) => ({
      file: `${i.group}/${i.id}.svg`,
      category: label(
        {
          bearings: "Bearings",
          linear: "Linear motion",
          drive: "Drive & transmission",
          springs: "Springs & seals",
          magnets: "Magnets",
          motors: "Motors",
        },
        i.group,
        "Motion",
      ),
      detail: String(i.code ?? ""),
      ...common(i),
    })),
};

function common(i: Item) {
  return {
    id: "",
    name: i.name,
    note: i.note ?? "",
    // Short names ("NTC", "SHCS", "Grub") are what people search for.
    keywords: i.short && i.short !== i.name ? i.short : "",
  };
}

function svgFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".svg"));
}

function build() {
  const icons: LabelIcon[] = [];
  for (const pack of PACK_ORDER) {
    const dir = join(PACKS_DIR, pack);
    if (!existsSync(dir)) {
      console.warn(`Skipping ${pack}: not in ${relative(ROOT, PACKS_DIR)}`);
      continue;
    }
    const data: Data = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    const svgDir = join(dir, "svg");
    const used = new Set<string>();
    for (const entry of RULES[pack](data)) {
      const path = join(svgDir, entry.file);
      // Not every combination exists (no set screw for wood, say).
      if (!existsSync(path)) continue;
      used.add(entry.file);
      const result = importSvg(readFileSync(path, "utf8"));
      if ("error" in result) throw new Error(`${relative(ROOT, path)}: ${result.error}`);
      const { file, ...meta } = entry;
      icons.push({
        ...meta,
        id: `${pack}/${file.replace(/\.svg$/, "")}`,
        viewBox: result.viewBox,
        markup: result.markup,
      });
    }
    const orphans = svgFiles(svgDir).filter((f) => !used.has(f));
    if (orphans.length) console.warn(`${pack}: no metadata for ${orphans.join(", ")}`);
  }
  writeFileSync(OUT, JSON.stringify(icons, null, 1) + "\n");
  console.log(`Wrote ${icons.length} icons to ${relative(ROOT, OUT)}`);
}

const args = process.argv.slice(2);
if (args[0] === "--vendor") args.slice(1).forEach(vendor);
else if (args.length) throw new Error("Usage: import-label-icons.ts [--vendor <pack dir>…]");
build();
