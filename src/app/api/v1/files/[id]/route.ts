import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { deletePartFile } from "@/lib/part-files";
import { serveFile } from "@/lib/serve-file";
import { failed, mutationError, noContent, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { apiRoute } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

// Downloads a part's image or document; Range requests work, like /api/files.
export const GET = apiRoute<Params>("parts:read", async ({ request, params }) => {
  if (!isUuid(params.id)) return notFound("File");
  const file = await db.query.files.findFirst({ where: eq(files.id, params.id) });
  if (!file) return notFound("File");
  return serveFile(request, file, { cacheControl: "private, no-store" });
});

export const DELETE = apiRoute<Params>("parts:write", async ({ params }) => {
  if (!isUuid(params.id)) return notFound("File");
  const result = await deletePartFile(params.id);
  return failed(result) ? mutationError(result) : noContent();
});
