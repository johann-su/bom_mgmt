import { fileKind, MAX_UPLOAD_BYTES } from "@/lib/file-kind";
import { storePartFiles } from "@/lib/part-files";
import { revalidateInventory } from "@/lib/part-mutations";
import { apiError, apiJson, invalidRequest, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { getPartDetail, findPart } from "@/lib/api/queries";
import { absoluteUrl, apiRoute, readBytes } from "@/lib/api/route";
import { serializeFile } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Attaches one image or document to a part: the raw bytes as the body, its
// name in ?filename= (the extension decides the kind and how it is served,
// never the request's Content-Type). Appended after the part's files, so the
// first image uploaded to a part without one becomes its thumbnail.
export const POST = apiRoute<{ id: string }>("parts:write", async ({ request, params }) => {
  if (!isUuid(params.id)) return notFound("Part");
  const filename = request.nextUrl.searchParams.get("filename")?.trim();
  if (!filename || filename.length > 255 || /[\\/]/.test(filename)) {
    return invalidRequest("?filename= is required (a bare file name, at most 255 characters)");
  }
  if (!fileKind(filename)) return invalidRequest(`File type not allowed: ${filename}`);
  if (!(await findPart(params.id))) return notFound("Part");

  const bytes = await readBytes(request, MAX_UPLOAD_BYTES);
  if (!bytes) {
    return apiError(413, "payload_too_large", `Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }
  if (bytes.byteLength === 0) return invalidRequest("Send the file's bytes as the request body");

  const stored = await storePartFiles(params.id, [{ name: filename, bytes }]);
  if ("error" in stored) return apiError(503, "unavailable", stored.error);
  revalidateInventory(params.id);

  const part = await getPartDetail(params.id);
  const file = part?.files.find((f) => f.id === stored.ids[0]);
  if (!file) return notFound("File");
  return apiJson(serializeFile(file, absoluteUrl), {
    status: 201,
    headers: { Location: absoluteUrl(`/api/v1/files/${file.id}`) },
  });
});
