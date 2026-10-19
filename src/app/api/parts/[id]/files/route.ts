import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { files, parts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { blobStore, newStorageKey } from "@/lib/storage";
import { contentTypeFor, fileKind, MAX_UPLOAD_BYTES } from "@/lib/file-kind";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// Uploads images/datasheets to a part (multipart form, field "files"). A
// route handler rather than a server action: server actions cap request
// bodies at 1 MB by default, and photos and datasheets are bigger.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const part = await db.query.parts.findFirst({ where: eq(parts.id, id), columns: { id: true } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const uploads = form?.getAll("files").filter((f): f is File => f instanceof File) ?? [];
  if (uploads.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });

  for (const upload of uploads) {
    if (!fileKind(upload.name)) {
      return NextResponse.json({ error: `${upload.name}: file type not allowed` }, { status: 400 });
    }
    if (upload.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `${upload.name} is too large` }, { status: 413 });
    }
  }

  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(files)
    .where(eq(files.partId, id));

  const created: string[] = [];
  for (const [index, upload] of uploads.entries()) {
    const key = newStorageKey(upload.name);
    try {
      await blobStore().put(key, new Uint8Array(await upload.arrayBuffer()), contentTypeFor(upload.name));
    } catch (err) {
      logger.error({ err }, `Failed to store upload ${upload.name}`);
      return NextResponse.json({ error: "Storage is unavailable" }, { status: 502 });
    }
    const [row] = await db
      .insert(files)
      .values({
        partId: id,
        storageKey: key,
        filename: upload.name,
        kind: fileKind(upload.name)!,
        size: upload.size,
        position: existing + index,
      })
      .returning({ id: files.id });
    created.push(row.id);
  }

  revalidatePath(`/parts/${id}`);
  revalidatePath("/parts");
  return NextResponse.json({ ids: created });
}
