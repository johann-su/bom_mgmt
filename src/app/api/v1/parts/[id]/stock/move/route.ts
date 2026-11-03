import { loadLocationOptions } from "@/lib/locations";
import { moveStock } from "@/lib/part-mutations";
import { apiJson, failed, invalidRequest, mutationError, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { getPartDetail, findPart } from "@/lib/api/queries";
import { absoluteUrl, apiRoute, readBody } from "@/lib/api/route";
import { StockMoveBody } from "@/lib/api/schemas";
import { serializePartDetail } from "@/lib/api/serialize";
import { resolvePlace, stockMoveInput } from "@/lib/api/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Moves a part's stock between two places; from the unsorted pile (null)
// puts it away. Logged as one "move" movement; answers with the part.
export const POST = apiRoute<{ id: string }>("stock:write", async ({ request, params, principal }) => {
  if (!isUuid(params.id)) return notFound("Part");
  const body = await readBody(request, StockMoveBody);
  const part = await findPart(params.id);
  if (!part) return notFound("Part");

  const locations = await loadLocationOptions();
  const from = resolvePlace(locations, body.from, "from");
  if ("error" in from) return invalidRequest(from.error);
  const to = resolvePlace(locations, body.to, "to");
  if ("error" in to) return invalidRequest(to.error);
  const move = stockMoveInput(part, body, { from: from.id, to: to.id });
  if ("error" in move) return invalidRequest(move.error);

  const result = await moveStock(principal.user.id, move.input);
  if (failed(result)) return mutationError(result);

  const updated = await getPartDetail(part.id);
  return updated ? apiJson(serializePartDetail(updated, absoluteUrl)) : notFound("Part");
});
