// Files on a part. Storing: blob first, then the row, appended after the
// part's existing files (the first image is the thumbnail) — shared by the
// upload routes and attaching a shop's datasheet/photo; callers validate
// names (fileKind) and sizes first. Deleting: shared by the part page and the
// REST API.

import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { blobStore, newStorageKey } from "@/lib/storage";
import { contentTypeFor, fileKind } from "@/lib/file-kind";
import { logger } from "@/lib/logger";
import { revalidateInventory, type MutationResult } from "@/lib/part-mutations";

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

// Deletes one file of a part. The row goes first; removing the stored object
// is best-effort, since an orphaned object is harmless.
export async function deletePartFile(fileId: string): Promise<MutationResult> {
  const [file] = await db
    .delete(files)
    .where(eq(files.id, fileId))
    .returning({ partId: files.partId, key: files.storageKey });
  if (!file) return { error: "File not found", code: "not_found" };
  try {
    await blobStore().delete([file.key]);
  } catch (err) {
    logger.warn({ err }, `Failed to delete stored file ${fileId}`);
  }
  revalidateInventory(file.partId);
  return {};
}
