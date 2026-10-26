import { asc } from "drizzle-orm";
import { db } from "@/db";
import { parts } from "@/db/schema";

// Every part as a picker option (name + MPN). Fine for a workshop-sized
// inventory; switch to a server-side search when that stops being true.
export async function loadPartOptions() {
  const rows = await db
    .select({
      id: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      manufacturer: parts.manufacturer,
      unit: parts.unit,
      tracking: parts.tracking,
    })
    .from(parts)
    .orderBy(asc(parts.name));
  return rows.map((p) => ({
    value: p.id,
    label: p.name,
    detail: [p.manufacturer, p.mpn].filter(Boolean).join(" · ") || undefined,
    unit: p.unit,
    tracking: p.tracking,
  }));
}
