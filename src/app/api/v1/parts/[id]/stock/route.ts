import { loadLocationOptions } from "@/lib/locations";
import { changeStock } from "@/lib/part-mutations";
import { apiJson, failed, invalidRequest, mutationError, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { getPartDetail, findPart } from "@/lib/api/queries";
import { absoluteUrl, apiRoute, readBody } from "@/lib/api/route";
import { StockChangeBody } from "@/lib/api/schemas";
import { serializePartDetail } from "@/lib/api/serialize";
import { resolvePlace, stockChangeInput } from "@/lib/api/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Books stock of one part in one place: add/remove/set for counted parts, a
// level for level/binary ones, "place" for untracked ones. Logged in the
// part's history under the key's user; answers with the part as it is now.
export const POST = apiRoute<{ id: string }>("stock:write", async ({ request, params, principal }) => {
  if (!isUuid(params.id)) return notFound("Part");
  const body = await readBody(request, StockChangeBody);
  const part = await findPart(params.id);
  if (!part) return notFound("Part");

  const place = resolvePlace(await loadLocationOptions(), body.location, "location");
  if ("error" in place) return invalidRequest(place.error);
  const change = stockChangeInput(part, body, place.id);
  if ("error" in change) return invalidRequest(change.error);

  const result = await changeStock(principal.user.id, change.input);
  if (failed(result)) return mutationError(result);

  const updated = await getPartDetail(part.id);
  return updated ? apiJson(serializePartDetail(updated, absoluteUrl)) : notFound("Part");
});
