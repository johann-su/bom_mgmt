import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";

// The thumbnail (first image by position) of each part, by part id.
export async function firstImages(partIds: string[]): Promise<Map<string, string>> {
  if (partIds.length === 0) return new Map();
  const rows = await db
    .select({ partId: files.partId, id: files.id })
    .from(files)
    .where(and(inArray(files.partId, partIds), eq(files.kind, "image")))
    .orderBy(asc(files.position), asc(files.createdAt));
  const out = new Map<string, string>();
  for (const row of rows) if (!out.has(row.partId)) out.set(row.partId, row.id);
  return out;
}
