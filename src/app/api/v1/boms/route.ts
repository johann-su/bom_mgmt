import { createBom } from "@/lib/bom-mutations";
import { apiJson, failed, mutationError, notFound } from "@/lib/api/http";
import { getBomDetail, listBomRows } from "@/lib/api/queries";
import { absoluteUrl, apiRoute, readBody } from "@/lib/api/route";
import { CreateBomBody } from "@/lib/api/schemas";
import { serializeBom, serializeBomDetail } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every BOM, most recently changed first, with how many units stock covers.
export const GET = apiRoute("boms:read", async () =>
  apiJson({ data: (await listBomRows()).map((row) => serializeBom(row, absoluteUrl)), nextCursor: null }),
);

// Creates an empty BOM; add lines with PUT /boms/{id}/lines/{partId}.
export const POST = apiRoute("boms:write", async ({ request, principal }) => {
  const body = await readBody(request, CreateBomBody);
  const result = await createBom(principal.user.id, { name: body.name, description: body.description ?? "" });
  if (failed(result)) return mutationError(result);

  const found = result.id ? await getBomDetail(result.id, 1) : null;
  if (!found) return notFound("BOM");
  return apiJson(serializeBomDetail(found.bom, found.lines, 1, absoluteUrl), {
    status: 201,
    headers: { Location: absoluteUrl(`/api/v1/boms/${found.bom.id}`) },
  });
});
