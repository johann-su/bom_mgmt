import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ICON_PACKS,
  groupIcons,
  iconPack,
  iconSvgDocument,
  isIconId,
  searchIcons,
  type LabelIcon,
} from "@/lib/label-icons";
import catalogue from "@/lib/label-icons.json";
import { sanitizeSvgMarkup } from "@/lib/svg-sanitize";

const icons = catalogue as LabelIcon[];

test("every library icon is already sanitised markup (the catalogue is injected as HTML)", () => {
  // Fails if someone hand-edits label-icons.json instead of re-running
  // scripts/import-label-icons.ts.
  for (const icon of icons) assert.equal(sanitizeSvgMarkup(icon.markup), icon.markup, icon.id);
});

test("icon ids are unique and every icon has a name, a category and a usable viewBox", () => {
  assert.equal(new Set(icons.map((i) => i.id)).size, icons.length);
  for (const icon of icons) {
    assert.ok(icon.name && icon.category, icon.id);
    assert.ok(icon.viewBox[2] > 0 && icon.viewBox[3] > 0, icon.id);
  }
});

test("groupIcons keeps catalogue order: components, packages, connectors, then screws", () => {
  const categories = groupIcons(icons).map((g) => g.category);
  const at = (c: string) => categories.indexOf(c);
  assert.equal(categories[0], "Components — passive");
  assert.ok(at("Components — passive") < at("Packages — SMD"));
  assert.ok(at("Packages — SMD") < at("Connectors — signal"));
  assert.ok(at("Connector variants") < at("Screw drives"));
});

test("every icon belongs to a known pack, so the picker's pack filter shows it", () => {
  for (const icon of icons) assert.ok(iconPack(icon) in ICON_PACKS, icon.id);
});

test("screw heads come per thread type, each with its sideways drawing right after it", () => {
  const wood = icons.filter((i) => i.category === "Screws — wood");
  assert.equal(wood[0].name, "Socket cap");
  assert.equal(wood[1].name, "Socket cap (sideways)");
  // Searching by thread type works even though it isn't in the head's name.
  assert.ok(searchIcons(icons, "pan self-tap").some((i) => i.name === "Pan"));
});

test("searchIcons needs every word to match somewhere: name, spec, category or note", () => {
  const names = (q: string) => searchIcons(icons, q).map((i) => i.name);
  assert.deepEqual(names("jst 2.00"), ["JST PH"]);
  // By standard, not only by name.
  assert.ok(names("iso 4762").includes("Socket cap"));
  assert.ok(names("NUT").includes("Hex nut"));
  // Short names count, so the common abbreviation finds the full name.
  assert.ok(names("ntc").includes("Thermistor"));
  assert.ok(names("sot-23").includes("SOT-23"));
  assert.deepEqual(names("torx nonsense"), []);
  assert.equal(searchIcons(icons, "  ").length, icons.length);
});

// Parts store an icon id and the thumbnail route serves it by path, so every
// catalogue id must pass the id check.
test("every catalogue id is a valid stored icon id", () => {
  for (const icon of icons) assert.ok(isIconId(icon.id), icon.id);
});

test("an icon becomes a standalone SVG document for an <img>", () => {
  const svg = iconSvgDocument({ viewBox: [0, 0, 48, 24], markup: '<circle cx="24" cy="12" r="5"/>' });
  // An <img> only renders SVG with the namespace declared.
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 48 24">/);
  assert.match(svg, /<circle cx="24" cy="12" r="5"\/><\/svg>$/);
});
