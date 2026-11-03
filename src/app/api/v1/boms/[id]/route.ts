import { deleteBom, updateBom } from "@/lib/bom-mutations";
import { apiJson, failed, invalidRequest, mutationError, noContent, notFound } from "@/lib/api/http";
import { isUuid, parseUnits } from "@/lib/api/params";
import { getBomDetail } from "@/lib/api/queries";
import { absoluteUrl, apiRoute, readBody } from "@/lib/api/route";
import { UpdateBomBody } from "@/lib/api/schemas";
import { serializeBomDetail } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

// One BOM with every line's stock, and what ?units= of it need and lack —
// the shopping list for a production run.
export const GET = apiRoute<Params>("boms:read", async ({ request, params }) => {
  const units = parseUnits(request.nextUrl.searchParams.get("units"));
  if (typeof units !== "number") return invalidRequest(units.error);
  const found = isUuid(params.id) ? await getBomDetail(params.id, units) : null;
  return found ? apiJson(serializeBomDetail(found.bom, found.lines, units, absoluteUrl)) : notFound("BOM");
});

export const PATCH = apiRoute<Params>("boms:write", async ({ request, params }) => {
  if (!isUuid(params.id)) return notFound("BOM");
  const patch = await readBody(request, UpdateBomBody);
  const current = await getBomDetail(params.id, 1);
  if (!current) return notFound("BOM");

  const result = await updateBom({
    id: params.id,
    name: patch.name ?? current.bom.name,
    description: patch.description ?? current.bom.description,
  });
  if (failed(result)) return mutationError(result);

  const found = await getBomDetail(params.id, 1);
  return found ? apiJson(serializeBomDetail(found.bom, found.lines, 1, absoluteUrl)) : notFound("BOM");
});

// Deletes the BOM and its lines. Parts and stock are untouched; past builds
// stay in the movement log without the BOM reference.
export const DELETE = apiRoute<Params>("boms:write", async ({ params }) => {
  if (!isUuid(params.id)) return notFound("BOM");
  const result = await deleteBom(params.id);
  return failed(result) ? mutationError(result) : noContent();
});
