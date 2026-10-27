import { test } from "node:test";
import assert from "node:assert/strict";
import { genericType } from "@/lib/generic-families";
import { rangeParam } from "@/lib/generic-parts";
import {
  applyGenericChoice,
  describeGenericType,
  genericCatalogue,
  readGenericChoice,
  readRange,
  requireGenericType,
  resolveStrict,
} from "@/lib/mcp/generic-input";
import { ToolError } from "@/lib/mcp/protocol";
import type { StoredPart } from "@/lib/mcp/tool-input";

const socketHead = genericType("fasteners", "socket-cap")!;
const xh = genericType("connectors", "jst-xh")!;

test("the catalogue lists every family with its type ids", () => {
  const fasteners = genericCatalogue().find((f) => f.family === "fasteners");
  assert.ok(fasteners?.types.some((t) => t.type === "socket-cap"));
  // Unknown ids name the valid ones, so the model can correct itself.
  assert.throws(() => requireGenericType("screws", "x"), (e) => e instanceof ToolError && /fasteners/.test(e.message));
  assert.throws(() => requireGenericType("fasteners", "torx"), (e) => e instanceof ToolError && /socket-cap/.test(e.message));
});

test("a model may name options by label or in any case; the rest gets defaults", () => {
  const { values } = resolveStrict(socketHead, { size: "m4", material: "Steel, black oxide" });
  assert.deepEqual(values, { drive: "iso4762", size: "M4", material: "black" });
});

// The dialog falls back silently; a model must hear about it, or asking for
// titanium would create an A2 screw.
test("a value that isn't offered is an error naming the options, never a fallback", () => {
  assert.throws(() => resolveStrict(socketHead, { material: "titanium" }), (e) => e instanceof ToolError && /a2/.test(e.message));
  // Valid on its own but ruled out by another choice: JST makes no male pins.
  assert.throws(() => resolveStrict(xh, { make: "jst", piece: "crimp-m" }), ToolError);
  // A crimp contact has no pin count.
  assert.throws(() => resolveStrict(xh, { piece: "crimp", pins: "4" }), (e) => e instanceof ToolError && /pins/.test(e.message));
});

test("range values are parsed like the wizard's input, from `range` and/or values", () => {
  const param = rangeParam(socketHead.params({ size: "M3" }));
  assert.deepEqual(readRange(param, { length: "6" }, ["8 mm", 10, "5,5"]), ["6", "8", "10", "5.5"]);
  assert.throws(() => readRange(param, {}, ["eight"]), ToolError);
  assert.throws(() => readRange(undefined, {}, ["8"]), ToolError, "a nut has no range");
});

test("describe previews the parts a range would make", () => {
  const described = describeGenericType("fasteners", socketHead, { size: "M3" }, ["8", "10"]);
  assert.deepEqual(described.values, { drive: "iso4762", size: "M3", material: "a2" });
  assert.ok(Array.isArray(described.preview));
  assert.deepEqual(
    described.preview.map((p) => ("name" in p ? p.name : p)),
    ["Socket head cap screw M3×8 A2-70", "Socket head cap screw M3×10 A2-70"],
  );
  assert.ok(described.parameters.some((p) => p.id === "length" && p.kind === "range"));
});

const generatedScrew = (): StoredPart => {
  const part = socketHead.generate({ drive: "iso4762", size: "M3", material: "a2", length: "8" });
  assert.ok(!("error" in part));
  return {
    name: part.name,
    description: part.description,
    categoryId: null,
    manufacturer: part.manufacturer,
    mpn: part.mpn,
    unit: part.unit,
    tracking: "level",
    minStock: null,
    orderUrls: [],
    icon: part.icon,
    attributes: part.attributes,
    generic: { family: "fasteners", type: "socket-cap", values: { drive: "iso4762", size: "M3", material: "a2", length: "8" } },
    notes: "",
  };
};

test("update_part's generic regenerates the part and stores the new choice", () => {
  const choice = readGenericChoice({ family: "fasteners", type: "socket-cap", values: { size: "M3", material: "black", length: 8 } }, "generic");
  const { part, kept } = applyGenericChoice(generatedScrew(), choice);
  assert.equal(part.name, "Socket head cap screw M3×8 12.9 black");
  assert.equal(part.mpn, "ISO 4762 M3x8 12.9 black");
  assert.equal(part.generic?.values.material, "black");
  assert.deepEqual(kept, []);
});

test("update_part's generic keeps hand-edited fields and needs exactly one range value", () => {
  const edited = { ...generatedScrew(), name: "Drawer 4 screws" };
  const choice = readGenericChoice({ family: "fasteners", type: "socket-cap", values: { material: "black", length: "8" } }, "generic");
  const { part, kept } = applyGenericChoice(edited, choice);
  assert.equal(part.name, "Drawer 4 screws");
  assert.deepEqual(kept, ["name"]);
  const noLength = readGenericChoice({ family: "fasteners", type: "socket-cap", values: { material: "black" } }, "generic");
  assert.throws(() => applyGenericChoice(generatedScrew(), noLength), ToolError);
});
