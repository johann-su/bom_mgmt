import { NextResponse } from "next/server";
import type { files } from "@/db/schema";
import { blobStore } from "@/lib/storage";
import { contentTypeFor, isInline } from "@/lib/file-kind";
import { parseByteRange } from "@/lib/http-range";

type StoredFile = Pick<typeof files.$inferSelect, "storageKey" | "filename" | "size">;

// Streams a part's stored file, for the app's /api/files and the REST API's
// /api/v1/files. Callers authorize first. Content type comes from the
// filename's allowlisted extension (never from the upload), and anything not
// safe to render inline is sent as an attachment. Supports byte ranges so
// browser PDF viewers can page through large datasheets.
export async function serveFile(
  request: Request,
  file: StoredFile,
  { cacheControl }: { cacheControl: string },
): Promise<Response> {
  const range = parseByteRange(request.headers.get("range"), file.size);
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
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  };
  if (blob.contentLength !== undefined) headers["Content-Length"] = String(blob.contentLength);
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${file.size}`;

  return new NextResponse(blob.stream, { status: range ? 206 : 200, headers });
}
