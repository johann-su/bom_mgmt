// Loads what locations hold for their labels (src/lib/label-contents.ts).

import { eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { parts, stock } from "@/db/schema";
import { loadIcons } from "@/lib/label-icons";
import { labelContents, type ContentPart, type LabelContents } from "@/lib/label-contents";

/**
 * Each location's label contents, by location id; locations holding nothing
 * are absent (use NO_CONTENTS). Without `locationIds`, every location.
 */
export async function loadLabelContents(locationIds?: string[]): Promise<Map<string, LabelContents>> {
  if (locationIds?.length === 0) return new Map();
  const rows = await db
    .select({ locationId: stock.locationId, attributes: parts.attributes })
    .from(stock)
    .innerJoin(parts, eq(parts.id, stock.partId))
    .where(locationIds ? inArray(stock.locationId, locationIds) : isNotNull(stock.locationId));
  if (rows.length === 0) return new Map();

  const byLocation = new Map<string, ContentPart[]>();
  for (const { locationId, attributes } of rows) {
    if (!locationId) continue;
    byLocation.set(locationId, [...(byLocation.get(locationId) ?? []), { attributes }]);
  }

  const catalogue = new Map((await loadIcons()).map((i) => [i.id, i]));
  const lookup = (id: string) => {
    const found = catalogue.get(id);
    return found && { markup: found.markup, viewBox: found.viewBox, name: found.name };
  };
  return new Map([...byLocation].map(([id, list]) => [id, labelContents(list, lookup)]));
}
