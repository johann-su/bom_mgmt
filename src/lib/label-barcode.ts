// Parses the 2D barcode on a distributor's component bag, for "scan label".
//
// DigiKey, Mouser, Farnell, TME and others print ECIA EIGP 114 labels: an
// ISO/IEC 15434 envelope ("[)>" RS "06" GS … RS EOT) of fields, each led by
// an ANSI MH10.8.2 data identifier — "1P" manufacturer part number, "Q"
// quantity, "K" purchase order, … LCSC prints its own brace format instead:
// {pbn:…,on:…,pc:C2040,pm:RP2040,qty:10,…}.
//
// Scanners in keyboard mode often can't type the GS/RS/EOT control
// characters; many can be set to send a stand-in ("{GS}", "^]", "␝"), which
// is accepted too.

export type ScannedLabel = {
  supplier: "DigiKey" | "Mouser" | "LCSC" | "";
  mpn: string;
  manufacturer: string;
  supplierPartNumber: string; // DigiKey's 30P, LCSC's C-number
  customerPartNumber: string; // P: your reference, or the distributor's PN
  quantity: number | null;
  purchaseOrder: string; // K
  salesOrder: string; // 1K / LCSC "on"
  lot: string;
  dateCode: string;
  countryOfOrigin: string;
  orderUrl: string; // where to reorder, derived from the supplier PN; "" if unknown
};

const GS = "\x1d";
const RS = "\x1e";
const EOT = "\x04";

const STAND_INS: [RegExp, string][] = [
  [/\{GS\}|<GS>|\[GS\]|␝|\^\]/g, GS],
  [/\{RS\}|<RS>|\[RS\]|␞|\^\^/g, RS],
  [/\{EOT\}|<EOT>|\[EOT\]|␄|\^D/g, EOT],
];

/** Null when the text is neither an EIGP 114 nor an LCSC label. */
export function parseLabelBarcode(raw: string): ScannedLabel | null {
  let text = raw.trim();
  for (const [pattern, char] of STAND_INS) text = text.replace(pattern, char);
  if (text.includes("[)>")) return parseEigp114(text);
  if (/^\{[\s\S]*\bp[cm]:/.test(text)) return parseLcsc(text);
  return null;
}

function empty(): ScannedLabel {
  return {
    supplier: "",
    mpn: "",
    manufacturer: "",
    supplierPartNumber: "",
    customerPartNumber: "",
    quantity: null,
    purchaseOrder: "",
    salesOrder: "",
    lot: "",
    dateCode: "",
    countryOfOrigin: "",
    orderUrl: "",
  };
}

function parseEigp114(text: string): ScannedLabel | null {
  // Mouser prints a stray ">" before the header; anything before "[)>" goes.
  const body = text.slice(text.indexOf("[)>") + 3);
  // Format "06" (data identifiers) follows the RS; without any GS the
  // fields can't be told apart.
  const match = body.match(/^\x1e?06\x1d([\s\S]*)$/);
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const field of match[1].split(GS)) {
    // A data identifier is up to three digits and one letter: "Q", "1P", "30P".
    const m = field.replace(/[\x1e\x04]+$/, "").match(/^(\d{0,3}[A-Z])([\s\S]*)$/);
    if (m && !fields.has(m[1])) fields.set(m[1], m[2].trim());
  }
  const get = (di: string) => fields.get(di) ?? "";

  const label = empty();
  label.mpn = get("1P");
  label.customerPartNumber = get("P");
  label.supplierPartNumber = get("30P");
  label.manufacturer = get("1V");
  label.purchaseOrder = get("K");
  label.salesOrder = get("1K");
  label.lot = get("1T");
  label.dateCode = get("9D") || get("10D");
  label.countryOfOrigin = get("4L");
  label.quantity = toQuantity(get("Q"));
  // DigiKey alone uses 30P (its own part number) and the 11Z–13Z pick-list
  // fields; Mouser numbers order lines with 14K.
  if (fields.has("30P") || fields.has("11Z")) label.supplier = "DigiKey";
  else if (fields.has("14K")) label.supplier = "Mouser";

  if (label.supplier === "DigiKey" && label.supplierPartNumber) {
    label.orderUrl = `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(label.supplierPartNumber)}`;
  } else if (label.supplier === "Mouser" && label.mpn) {
    label.orderUrl = `https://www.mouser.com/c/?q=${encodeURIComponent(label.mpn)}`;
  }
  return label.mpn || label.customerPartNumber || label.supplierPartNumber ? label : null;
}

function parseLcsc(text: string): ScannedLabel | null {
  const fields = new Map<string, string>();
  // Split only at ",key:" so a comma inside a value survives.
  for (const pair of text.replace(/^\{|\}$/g, "").split(/,(?=[a-z]+:)/)) {
    const colon = pair.indexOf(":");
    if (colon > 0) fields.set(pair.slice(0, colon).trim(), pair.slice(colon + 1).trim());
  }
  const get = (key: string) => {
    const value = fields.get(key) ?? "";
    return value === "null" ? "" : value;
  };
  const label = empty();
  label.supplier = "LCSC";
  label.mpn = get("pm");
  label.supplierPartNumber = get("pc");
  label.salesOrder = get("on");
  label.quantity = toQuantity(get("qty"));
  if (/^C\d+$/i.test(label.supplierPartNumber)) {
    label.orderUrl = `https://www.lcsc.com/product-detail/${label.supplierPartNumber.toUpperCase()}.html`;
  }
  return label.mpn || label.supplierPartNumber ? label : null;
}

function toQuantity(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}
