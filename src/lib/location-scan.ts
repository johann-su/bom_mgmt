import type { LocationOption } from "@/lib/location-tree";

// Resolves what a scanned location label holds to the location. The label
// designer lets a code carry any template variable, so a sticker may encode
// the code ("A/1/IV"), the link to the location's page, the bare id, the
// readable path or the name. Code 39 can only hold upper case, so every
// comparison ignores case.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID_RE = new RegExp(`^${UUID}$`, "i");
const URL_ID_RE = new RegExp(`/locations/(${UUID})(?:[/?#]|$)`, "i");

export function resolveScannedLocation(locations: LocationOption[], text: string): LocationOption | null {
  const t = text.trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  // A link or an id names the location outright. The host isn't checked:
  // labels printed before a domain move still point at the right id.
  const id = (URL_ID_RE.exec(t)?.[1] ?? (ID_RE.test(t) ? t : "")).toLowerCase();
  if (id) return locations.find((l) => l.id.toLowerCase() === id) ?? null;

  const exactCode = locations.find((l) => l.code.toLowerCase() === lower);
  if (exactCode) return exactCode;
  const exactPath = locations.find((l) => l.path.toLowerCase() === lower);
  if (exactPath) return exactPath;

  // Separators ignored, as a hand-held scanner or Code 39's charset may mangle
  // them — but only when that's unambiguous ("A/11" and "A1/1" both compact
  // to "a11").
  const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const unique = (matches: LocationOption[]) => (matches.length === 1 ? matches[0] : null);
  const c = compact(t);
  return (
    (c ? unique(locations.filter((l) => compact(l.code) === c)) : null) ??
    unique(locations.filter((l) => l.name && l.name.toLowerCase() === lower))
  );
}
