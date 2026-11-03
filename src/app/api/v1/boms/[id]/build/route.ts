import { buildBom } from "@/lib/bom-mutations";
import { loadLocationOptions } from "@/lib/locations";
import { apiJson, failed, mutationError, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { partNames } from "@/lib/api/queries";
import { apiRoute, readBody } from "@/lib/api/route";
import { BuildBomBody } from "@/lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Builds units of a BOM: takes every counted line's parts out of stock,
// emptiest bins first, all or nothing (409 when anything is short). A stock
// operation, hence stock:write — a build kiosk needs no say over the BOM.
// Answers with what was taken from where, e.g. to print a pick list.
export const POST = apiRoute<{ id: string }>("stock:write", async ({ request, params, principal }) => {
  if (!isUuid(params.id)) return notFound("BOM");
  const body = await readBody(request, BuildBomBody);
  const result = await buildBom(principal.user.id, { bomId: params.id, units: body.units, note: body.note });
  if (failed(result)) return mutationError(result);

  const draws = result.draws ?? [];
  const [names, locations] = await Promise.all([
    partNames([...new Set(draws.map((d) => d.partId))]),
    loadLocationOptions(),
  ]);
  const placeById = new Map(locations.map((l) => [l.id, { id: l.id, code: l.code, path: l.path }]));
  return apiJson({
    units: body.units,
    draws: draws.map((d) => ({
      part: { id: d.partId, name: names.get(d.partId) ?? "" },
      location: d.locationId ? (placeById.get(d.locationId) ?? null) : null,
      quantity: d.quantity,
    })),
  });
});
