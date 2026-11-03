import { removeBomLine, setBomLine } from "@/lib/bom-mutations";
import { apiJson, failed, mutationError, noContent, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { getBomDetail } from "@/lib/api/queries";
import { apiRoute, readBody } from "@/lib/api/route";
import { SetBomLineBody } from "@/lib/api/schemas";
import { serializeBomLine } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string; partId: string };

// A BOM's line for one part, addressed by the part since a BOM lists each
// part once. PUT sets it — adding the line if the BOM doesn't list the part
// yet (201), replacing it otherwise (200) — so pushing a whole BOM is a PUT
// per line, safe to repeat.
export const PUT = apiRoute<Params>("boms:write", async ({ request, params }) => {
  if (!isUuid(params.id) || !isUuid(params.partId)) return notFound("BOM or part");
  const body = await readBody(request, SetBomLineBody);
  const result = await setBomLine({ bomId: params.id, partId: params.partId, ...body });
  if (failed(result)) return mutationError(result);

  const line = (await getBomDetail(params.id, 1))?.lines.find((l) => l.partId === params.partId);
  if (!line) return notFound("BOM line");
  return apiJson(serializeBomLine(line), { status: result.created ? 201 : 200 });
});

export const DELETE = apiRoute<Params>("boms:write", async ({ params }) => {
  if (!isUuid(params.id) || !isUuid(params.partId)) return notFound("BOM or part");
  const result = await removeBomLine({ bomId: params.id, partId: params.partId });
  return failed(result) ? mutationError(result) : noContent();
});
