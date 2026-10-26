// Stores files on a part: blob first, then the row, appended after the
// part's existing files (the first image is the thumbnail). Shared by the
// upload route and attaching a shop's datasheet/photo. Callers validate
// names (fileKind) and sizes first.

import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { blobStore, newStorageKey } from "@/lib/storage";
import { contentTypeFor, fileKind } from "@/lib/file-kind";
import { logger } from "@/lib/logger";

export async function storePartFiles(
  partId: string,
  uploads: { name: string; bytes: Uint8Array }[],
): Promise<{ ids: string[] } | { error: string }> {
  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(files)
    .where(eq(files.partId, partId));

  const ids: string[] = [];
  for (const [index, upload] of uploads.entries()) {
    const key = newStorageKey(upload.name);
    try {
      await blobStore().put(key, upload.bytes, contentTypeFor(upload.name));
    } catch (err) {
      logger.error({ err }, `Failed to store upload ${upload.name}`);
      return { error: "Storage is unavailable" };
    }
    const [row] = await db
      .insert(files)
      .values({
        partId,
        storageKey: key,
        filename: upload.name,
        kind: fileKind(upload.name)!,
        size: upload.bytes.byteLength,
        position: existing + index,
      })
      .returning({ id: files.id });
    ids.push(row.id);
  }
  return { ids };
}
