// Free-form key/value attributes on a part ("Thread: M3", "Length: 5 mm",
// "Resistance: 10 kΩ"). Stored as an ordered JSON array on parts.attributes.

export type PartAttribute = { key: string; value: string };

const MAX_ATTRIBUTES = 50;
const MAX_LENGTH = 200;

/**
 * Normalizes untrusted attribute input from a form: trims, drops rows with no
 * key, and de-duplicates keys case-insensitively (last one wins, keeping the
 * first one's position) so a part never shows two "Thread" rows.
 */
export function normalizeAttributes(raw: unknown): PartAttribute[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, PartAttribute>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const key = String((entry as PartAttribute).key ?? "").trim().slice(0, MAX_LENGTH);
    const value = String((entry as PartAttribute).value ?? "").trim().slice(0, MAX_LENGTH);
    if (!key) continue;
    const id = key.toLowerCase();
    const existing = byKey.get(id);
    if (existing) existing.value = value;
    else byKey.set(id, { key, value });
  }
  return [...byKey.values()].slice(0, MAX_ATTRIBUTES);
}

/**
 * Merges imported attributes into a part's existing ones: a key already there
 * (case-insensitively) takes the new value in place, new keys append, and
 * keys the import doesn't mention are kept.
 */
export function mergeAttributes(existing: PartAttribute[], incoming: PartAttribute[]): PartAttribute[] {
  return normalizeAttributes([...existing, ...incoming]);
}
