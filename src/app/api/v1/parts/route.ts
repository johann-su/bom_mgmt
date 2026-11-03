import { loadLocationOptions } from "@/lib/locations";
import { createPart } from "@/lib/part-mutations";
import { apiJson, failed, invalidRequest, mutationError, notFound } from "@/lib/api/http";
import { parsePartListQuery } from "@/lib/api/params";
import { getPartDetail, listParts, locationSubtree } from "@/lib/api/queries";
import { resolveCategory } from "@/lib/api/resolve";
import { absoluteUrl, apiRoute, readBody } from "@/lib/api/route";
import { CreatePartBody } from "@/lib/api/schemas";
import { serializePart, serializePartDetail } from "@/lib/api/serialize";
import { createPartValues, resolvePlace } from "@/lib/api/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The inventory, by name by default. Filters combine with AND; see the
// OpenAPI document (GET /api/v1/openapi.json) for the parameters.
export const GET = apiRoute("parts:read", async ({ request }) => {
  const query = parsePartListQuery(request.nextUrl.searchParams);
  if ("error" in query) return invalidRequest(query.error);

  let locationIds: string[] | undefined;
  if (query.locationId) {
    const subtree = await locationSubtree(query.locationId);
    if (!subtree) return notFound("Location");
    locationIds = subtree;
  }

  const { rows, nextCursor } = await listParts({ ...query, locationIds });
  return apiJson({ data: rows.map((row) => serializePart(row, absoluteUrl)), nextCursor });
});

// Creates a part, optionally with its first stock — logged under the key's
// user like a part added in the app.
export const POST = apiRoute("parts:write", async ({ request, principal }) => {
  const body = await readBody(request, CreatePartBody);

  let stockLocationId: string | null = null;
  if (body.stock) {
    const place = resolvePlace(await loadLocationOptions(), body.stock.location, "stock.location");
    if ("error" in place) return invalidRequest(place.error);
    stockLocationId = place.id;
  }
  const category = await resolveCategory(body);
  if ("error" in category) return invalidRequest(category.error);

  const input = createPartValues(body, { categoryId: category.categoryId ?? null, stockLocationId });
  if ("error" in input) return invalidRequest(input.error);

  const result = await createPart(principal.user.id, input.values);
  if (failed(result)) return mutationError(result);

  const part = result.id ? await getPartDetail(result.id) : null;
  if (!part) return notFound("Part");
  return apiJson(serializePartDetail(part, absoluteUrl), {
    status: 201,
    headers: { Location: absoluteUrl(`/api/v1/parts/${part.id}`) },
  });
});
