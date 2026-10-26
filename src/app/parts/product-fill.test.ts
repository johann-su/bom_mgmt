import { test } from "node:test";
import assert from "node:assert/strict";
import { fillAttributes, shopFiles, suggestCategory } from "@/app/parts/product-fill";
import type { ProductInfo } from "@/lib/product-page";

const CATEGORIES = [
  { id: "ic", name: "ICs" },
  { id: "res", name: "Resistor" },
];

test("an existing category matching any level of the shop's path is picked, most specific first", () => {
  // The user renamed LCSC's leaf to their own "Resistor"; the parent "Resistors" finds it.
  assert.deepEqual(suggestCategory(["Resistors", "Chip Resistor - Surface Mount"], CATEGORIES), { id: "res" });
  assert.deepEqual(suggestCategory(["ICS", "Embedded"], CATEGORIES), { id: "ic" }); // case-insensitive
});

test("with no matching category, the shop's leaf is suggested as a new name", () => {
  assert.deepEqual(suggestCategory(["RF and Wireless", "RF Transceiver Modules and Modems"], CATEGORIES), {
    name: "RF Transceiver Modules and Modems",
  });
  assert.equal(suggestCategory([], CATEGORIES), null);
});

test("shop specs add to the attributes without overwriting what the user typed", () => {
  const filled = fillAttributes(
    [
      { key: "Package", value: "custom" },
      { key: "", value: "" }, // the form's empty starter row
    ],
    [
      { key: "package", value: "SOT-23" },
      { key: "Voltage", value: "3.3V" },
    ],
  );
  assert.deepEqual(filled, [
    { key: "Package", value: "custom" },
    { key: "Voltage", value: "3.3V" },
  ]);
});

test("shop files are named after the part, photo first so it becomes the thumbnail", () => {
  const product = {
    name: "ESPRESSIF ESP32-WROOM-32E-N4",
    mpn: "ESP32-WROOM-32E-N4",
    image: "https://assets.example/front.jpg",
    datasheet: "https://datasheet.example/abc.pdf",
  } as ProductInfo;
  assert.deepEqual(
    shopFiles(product, "ESP32-WROOM-32E").map((f) => f.name),
    ["ESP32-WROOM-32E", "ESP32-WROOM-32E datasheet"],
  );
  // Without a name typed yet, the MPN names them.
  assert.equal(shopFiles({ ...product, image: "" }, " ")[0].name, "ESP32-WROOM-32E-N4 datasheet");
});
