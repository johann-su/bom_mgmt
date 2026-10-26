import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { parts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { fileKind, MAX_UPLOAD_BYTES } from "@/lib/file-kind";
import { storePartFiles } from "@/lib/part-files";

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

  const stored = await storePartFiles(
    id,
    await Promise.all(
      uploads.map(async (upload) => ({ name: upload.name, bytes: new Uint8Array(await upload.arrayBuffer()) })),
    ),
  );
  if ("error" in stored) return NextResponse.json({ error: stored.error }, { status: 502 });

  revalidatePath(`/parts/${id}`);
  revalidatePath("/parts");
  return NextResponse.json({ ids: stored.ids });
}
