import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLabelBarcode } from "@/lib/label-barcode";

const GS = "\x1d";
const RS = "\x1e";
const EOT = "\x04";

// A DigiKey bag: P = DigiKey PN (no customer reference given), 1P = MPN,
// 30P = DigiKey PN, Q = quantity, 11Z–13Z pick-list fields.
const DIGIKEY =
  `[)>${RS}06${GS}P296-1411-5-ND${GS}1PNE555P${GS}30P296-1411-5-ND${GS}K${GS}1K12345678` +
  `${GS}10K13579${GS}9D2240${GS}1TA1B2C3${GS}4LMY${GS}Q25${GS}11ZPICK${GS}12Z1234567${GS}13Z999999${RS}${EOT}`;

test("DigiKey EIGP 114 label: MPN, quantity, sales order and a reorder link", () => {
  const label = parseLabelBarcode(DIGIKEY);
  assert.ok(label);
  assert.equal(label.supplier, "DigiKey");
  assert.equal(label.mpn, "NE555P");
  assert.equal(label.supplierPartNumber, "296-1411-5-ND");
  assert.equal(label.quantity, 25);
  assert.equal(label.salesOrder, "12345678");
  assert.equal(label.purchaseOrder, "", "an empty K field stays empty");
  assert.equal(label.countryOfOrigin, "MY");
  assert.match(label.orderUrl, /^https:\/\/www\.digikey\.com\/.*296-1411-5-ND/);
});

test("data identifiers split at the last leading letter: 'PRP2040' is P + RP2040", () => {
  const label = parseLabelBarcode(`[)>${RS}06${GS}PRP2040${GS}1PRP2040${GS}Q7${RS}${EOT}`);
  assert.equal(label?.customerPartNumber, "RP2040");
  assert.equal(label?.mpn, "RP2040");
});

test("Mouser's stray leading '>' is ignored and 14K marks the label as Mouser's", () => {
  const label = parseLabelBarcode(`>[)>${RS}06${GS}KPO-77${GS}14K001${GS}1PLM317T${GS}Q100${GS}1VTexas Instruments${RS}${EOT}`);
  assert.equal(label?.supplier, "Mouser");
  assert.equal(label?.purchaseOrder, "PO-77");
  assert.equal(label?.manufacturer, "Texas Instruments");
  assert.equal(label?.quantity, 100);
});

test("scanner stand-ins for the control characters ({GS}, ^], ␝) are understood", () => {
  for (const [gs, rs] of [
    ["{GS}", "{RS}"],
    ["^]", "^^"],
    ["␝", "␞"],
  ]) {
    const label = parseLabelBarcode(`[)>${rs}06${gs}1PNE555P${gs}Q5${rs}`);
    assert.equal(label?.mpn, "NE555P", gs);
    assert.equal(label?.quantity, 5, gs);
  }
});

test("a label whose separators were dropped by the scanner is rejected, not misread", () => {
  assert.equal(parseLabelBarcode("[)>061PNE555PQ5"), null);
});

test("LCSC brace format: pm = MPN, pc = LCSC number → product page link", () => {
  const label = parseLabelBarcode(
    "{pbn:PICK2207250052,on:WM2207250103,pc:C2040,pm:RP2040,qty:10,mc:,cc:1,pdi:66542587,hp:null,wc:JS}",
  );
  assert.ok(label);
  assert.equal(label.supplier, "LCSC");
  assert.equal(label.mpn, "RP2040");
  assert.equal(label.quantity, 10);
  assert.equal(label.salesOrder, "WM2207250103");
  assert.equal(label.orderUrl, "https://www.lcsc.com/product-detail/C2040.html");
});

test("anything else — a plain 1D code, a URL — is not a supplier label", () => {
  assert.equal(parseLabelBarcode("NE555P"), null);
  assert.equal(parseLabelBarcode("https://example.com"), null);
});
