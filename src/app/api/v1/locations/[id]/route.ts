import { apiJson, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { getLocation } from "@/lib/api/queries";
import { absoluteUrl, apiRoute } from "@/lib/api/route";
import { serializeLocationDetail } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One location with the locations directly inside it. What it holds is
// listed by GET /parts?location=<id>, with all of that endpoint's filters.
export const GET = apiRoute<{ id: string }>("parts:read", async ({ params }) => {
  const found = isUuid(params.id) ? await getLocation(params.id) : null;
  return found
    ? apiJson(serializeLocationDetail(found.location, found.children, absoluteUrl))
    : notFound("Location");
});
