import { test } from "node:test";
import assert from "node:assert/strict";
import icons from "@/lib/label-icons.json";
import { GENERIC_FAMILIES } from "@/lib/generic-families";
import { rangeParam, resolveValues, type GenericParam, type GenericValues } from "@/lib/generic-parts";

const known = new Set(icons.map((i) => i.id));

// Every combination of select values a type offers (following how one choice
// changes the others), with the first range option filled in.
function* combinations(params: (v: GenericValues) => GenericParam[], values: GenericValues = {}): Generator<GenericValues> {
  const open = params(values).find((p) => p.kind === "select" && !(p.id in values));
  if (open && open.kind === "select") {
    for (const option of open.options) yield* combinations(params, { ...values, [open.id]: option.value });
    return;
  }
  const range = rangeParam(params(values));
  yield range ? { ...values, [range.id]: range.options[0] } : values;
}

test("every generic type generates for every option it offers, with real icons and no holes", () => {
  // Guards the data tables of every family: a missing dimension shows up as
  // NaN/undefined, a renamed catalogue icon as a blank tile or thumbnail.
  for (const family of GENERIC_FAMILIES) {
    for (const type of family.types) {
      assert.ok(known.has(type.icon), `${type.id} tile icon ${type.icon}`);
      let count = 0;
      for (const values of combinations(type.params)) {
        const part = type.generate(resolveValues(type, values).values);
        const label = `${type.id} ${JSON.stringify(values)}`;
        if ("error" in part) assert.fail(`${label}: ${part.error}`);
        count++;
        for (const id of [part.icon, ...part.preview]) assert.ok(known.has(id), `${label}: icon ${id}`);
        const text = [part.name, part.description, part.mpn, ...part.attributes.map((a) => a.value)].join(" ");
        assert.doesNotMatch(text, /NaN|undefined|null/, label);
      }
      assert.ok(count > 0, type.id);
    }
  }
});

test("type ids are unique within a family, so the wizard can address them", () => {
  for (const family of GENERIC_FAMILIES) {
    const ids = family.types.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, family.id);
  }
});
