import { test } from "node:test";
import assert from "node:assert/strict";
import { printheadProblem, rasterSize, toMonochrome } from "@/lib/niimbot-raster";

test("rasterSize converts mm to printer dots (203 dpi ≈ 8 dots/mm)", () => {
  assert.deepEqual(rasterSize({ width: 40, height: 12 }, 203), { width: 320, height: 96 });
  assert.deepEqual(rasterSize({ width: 50, height: 30 }, 300), { width: 591, height: 354 });
});

test("sideways-fed printers (D11, 'left') must fit the label's height across the head", () => {
  // 40×12 mm on a D11: 96 dots across a 96-dot head — fits.
  assert.equal(printheadProblem({ width: 320, height: 96 }, 96, "left"), null);
  // 40×15 mm is too tall for it, however long the label is.
  assert.match(printheadProblem({ width: 320, height: 120 }, 96, "left") ?? "", /height/);
});

test("top-fed printers (B1, 'top') must fit the label's width across the head", () => {
  assert.equal(printheadProblem({ width: 384, height: 600 }, 384, "top"), null);
  assert.match(printheadProblem({ width: 400, height: 240 }, 384, "top") ?? "", /width/);
});

test("toMonochrome leaves only pure black and pure white — the encoder burns any non-white pixel", () => {
  const px = new Uint8ClampedArray([
    0, 0, 0, 255, // black
    200, 200, 200, 255, // light antialias grey → white
    60, 60, 60, 255, // dark antialias grey → black
    0, 0, 0, 0, // transparent → white, not black
  ]);
  assert.deepEqual([...toMonochrome(px)], [
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]);
});
