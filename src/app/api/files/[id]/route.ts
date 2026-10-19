import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { isUuid } from "@/lib/utils";
import { files } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { blobStore } from "@/lib/storage";
import { contentTypeFor, isInline } from "@/lib/file-kind";
import { parseByteRange } from "@/lib/http-range";

export const runtime = "nodejs";


// Serves a part's image or document to signed-in users. Content type comes
// from the filename's allowlisted extension (never from the upload), and
// anything not safe to render inline is sent as an attachment. Supports byte
// ranges so browser PDF viewers can page through large datasheets.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const file = await db.query.files.findFirst({ where: eq(files.id, id) });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const range = parseByteRange(req.headers.get("range"), file.size);
  if (range === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${file.size}` },
    });
  }

  const blob = await blobStore().get(file.storageKey, range ?? undefined);
  if (!blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const disposition = isInline(file.filename) ? "inline" : "attachment";
  const headers: Record<string, string> = {
    "Content-Type": contentTypeFor(file.filename),
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "Accept-Ranges": "bytes",
    // Ids are immutable (a replaced file gets a new id); private because the
    // response is cookie-authenticated.
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  if (blob.contentLength !== undefined) headers["Content-Length"] = String(blob.contentLength);
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${file.size}`;

  return new NextResponse(blob.stream, { status: range ? 206 : 200, headers });
}
